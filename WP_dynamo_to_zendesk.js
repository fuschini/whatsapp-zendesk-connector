/*
  Lambda function executed when the DynamoDB recieves a new message from the Whatsapp Webhook
*/

exports.handler = handler

const AWS = require('aws-sdk');
const dynamoDb = new AWS.DynamoDB.DocumentClient();

const zendesk = require('./zendeskApiMethods.js')

/*
Lambda handler - only passes the recieved event to handleEventWrapper() and generates the response
INPUTS:
  - event: DynamoDB stream event with the data of the records that activated the trigger (may have one or more records)
  - context: lambda standard variable. Not used here
  - callback: callback to the lambda function
OUTPUT:
  - If success: An optional object as the second parameter in the callback
  - If fail: An object as the first parameter in the callback that will be treated like an error
*/
function handler(event, context, callback) {

  console.log(JSON.stringify(event, null, 2));

  console.log(event.Records);

  handleEventWrapper(event.Records)
  .then((res) => {

    // If any record failed to be treated, returns an error and the event will be sent again by the stream
    if (res.failedRecords && res.failedRecords.length > 0) {
      console.log("Finished handling records with some errors: ", res.failedRecords);
      console.log("Succeded messages: ", res.successfulRecords);

      callback(res);
    }
    else {// If all events were treated succsesfully, returns a success and the event will not sent again
      console.log("Handled messages with no errors: ", res);

      callback(null, res)
    }
  })
  .catch((err) => { // If another error occurs, also returns an error
    console.log("Error handling some messages: ", err);

    callback(err)
  })
};

/*
Handles all the records of the event
INPUTS:
  - streamRecords: An array of DynamoDB records that activated the stream
OUTPUT:
  - An object like the following with the succsesfully treated records and the failed ones
  {
    successfulRecords: [successfulRecords],
    failedRecords: [failedRecords]
  }
*/
async function handleEventWrapper(streamRecords) {

  var successfulRecords = []
  var failedRecords = []

  // Handles each event of tyme INSERT. Ignores the rest
  for (var record of streamRecords) {

    if (record.eventName != "INSERT") {
      continue
    }

    try {
      var res = await handleEvent(record)

      console.log("Handled record: ", res);

      successfulRecords.push({
        record: record,
        status: res
      })

    } catch (err) {
      console.log("Error handling record: ", err);


      failedRecords.push({
        record: record,
        err: err
      })

    }
  }

  return {
    successfulRecords: successfulRecords,
    failedRecords: failedRecords
  }
}

/*
Handles one record at a time
INPUT:
  - record: A DynamoDB record object
OUTPUT:
  - If succsesfull: a resolved promise
  - If fail: a rejected promise with an error
*/
function handleEvent(record) {
  return new Promise ((resolve, reject) => {

    let sortedMessages

    // IMPORTANT: Gets ALL contacts unhandled messages from dynamo (not only the one in the record)
    getUnhandledMsgsByPhone(record.dynamodb.Keys.wa_id.S)
    .then((unhandledMsgs) => {

      // Locks messages on dynamo to prevent another lambda to process it at the same time
      return lockUnhandledMsgs(unhandledMsgs)

    })
    .then((res) => {

      // If there is an error locking any message, stops execution
      if (res.failedMsgs && res.failedMsgs.length > 0) {
        reject(res)
      } else {

        console.log("Locked all messages: ", res);

        // resolve(res)

        // Sorts messages by timestamp in asc order
        sortedMessages = res.successfulMsgs.sort((msg1, msg2) => {
          if (parseInt(msg1.timestamp) <= parseInt(msg2.timestamp)) {
            return -1
          } else {
            return 1
          }
        })

        console.log("Sorted messages: ", JSON.stringify(sortedMessages,null,2));

        // Each message will be sent to WhatsApp
        return zendeskWrapper(sortedMessages, record.dynamodb.Keys.wa_id.S)
      }

    })
    .then((zendeskResponse) => {

      // If there is an error sending any message, stops execution
      if (zendeskResponse.failedMsgs && zendeskResponse.failedMsgs.length > 0) {
        reject(zendeskResponse)
      } else {
        console.log(zendeskResponse);

        // On success: sets messages as handled on dynamo and removes lock
        return setMessagesAsHandled(sortedMessages)
      }

    })
    .then((res) => {
      resolve()
    })
    .catch((err) => {

      console.log("Error in handleEvent: ", err);

      if (err. message && err.message == 'No items to process') {
        resolve('No items to process')
      } else {
        console.log("Unlocking messages");

        // On error: unlocks message on dynamo
        unlockMessages(sortedMessages)
        .then((res) => {
          console.log("Unlocked messages");
          reject(err)
        })
        .catch((err2) => {
          console.log("Error unlocking messages: ", err2);
          reject(err2)
        })

      }

    })

  })
}

/*
Gets all unhandled messages of a contact from DynamoDB
INPUT:
  - phoneNumber: The contact phonenumber in the wa_id format
OUTPUT:
  - If there are any messages to process: a resolved promise with an array with all unhandled messages of the contact
  - If fail or there are no messages to process: a rejected promise with an error
*/
function getUnhandledMsgsByPhone(phoneNumber) {
  return new Promise ((resolve, reject) => {

    // Builds the DynamoDB query
    // SELECT * from whatsappMessagesTable where wa_id = phoneNumber and handled = false and lock = false
    var params = {
      TableName: process.env.whatsappMessagesTable,
      ConsistentRead: true,
      KeyConditionExpression: "wa_id = :wa_id",
      FilterExpression: "handled = :handledVal and #lock = :lockVal",
      ExpressionAttributeNames: {'#lock' : 'lock'},
      ExpressionAttributeValues : {
        ":handledVal": false,
        ":lockVal": false,
        ":wa_id": phoneNumber
      }
    };

    dynamoDb.query(params).promise()
    .then((res) => {

      console.log("Got item from DB: ", JSON.stringify(res,null, 2));

      if (res.Count == 0) {
        console.log("No items on DB to process. Rejecting promisse with message 'No items to process'");
        reject({message: 'No items to process'})
      } else {
        resolve(res.Items)
      }

    })
    .catch((err) => {
      reject(err)
    })
  })
}

/*
Sets all messages recieved as locked in DynamoDB
INPUT:
  - unhandledMsgs: an array of DynamoDB records
OUTPUT:
  - An object like the following with the succsesfully treated messages and the failed ones
  {
    successfulMsgs: [successfulMsgs],
    failedMsgs: [failedMsgs]
  }
*/
async function lockUnhandledMsgs(unhandledMsgs) {

  var successfulMsgs = []
  var failedMsgs = []

  // For every message in the input array
  for (var message of unhandledMsgs) {

    // Builds the DynamoDB query
    // UPDATE whatsappMessagesTable SET lock = true where wa_id = message.wa_id and commentId = message.commentId
    var params = {
      TableName: process.env.whatsappMessagesTable,
      Key: {
        wa_id: message.wa_id,
        msg_id: message.msg_id
      },
      UpdateExpression: 'set #lock = :lockVal',
      ExpressionAttributeNames: {'#lock' : 'lock'},
      ExpressionAttributeValues: {
        ':lockVal' : true
      }
    };

    try {

      var res = await dynamoDb.update(params).promise()
      console.log("Updated item on DB: ", res);

      successfulMsgs.push(message)
    } catch (err) {

      console.log("Error updating item on DB: ", err);
      failedMsgs.push(message)
    }

  }

  return {
    successfulMsgs: successfulMsgs,
    failedMsgs: failedMsgs
  }
}

/*
Queries for all open tickets from a contact given its phoneNumber
INPUTS:
  - phoneNumber: the contact phonenumber in the wa_id format
OUTPUT:
  - A pending promise from the DynamoDB query
*/
function getOpenTicket(phoneNumber) {

  // Builds the DynamoDB query
  // SELECT * from whatsappTicketsTable where wa_id = phoneNumber
  var params = {
    TableName: process.env.whatsappTicketsTable,
    ConsistentRead: true,
    KeyConditionExpression: "wa_id = :wa_id",
    ExpressionAttributeValues : {
      ":wa_id": phoneNumber
    }
  };

  return dynamoDb.query(params).promise()
}

/*
Syncs every message with zendesk creating a new ticket or updating an
existing one if necessary
INPUTS:
  - messages: an array of the contacts unhandled messages from DynamoDB
  - wa_id: the contact phonenumber in the wa_id format
OUTPUT:
  - An object like the one below
  {
    failedMsgs: [an array of failed messages]
  }
*/
async function zendeskWrapper(messages, wa_id) {

  // Gets open tickets from the wa_id in DynamoDB
  try {
    var openTickets = await getOpenTicket(wa_id)
  } catch (err) {
    throw err
  }

  let openTicketId
  let requesterId
  var failedMsgs = []

  // If there are no open tickets, creates one
  if (openTickets.Count == 0) {

    // Creates the ticket and puts the new ticket id and the requester id in the
    // openTicketId and requesterId variables
    try {
      // Already puts the first message in the created ticket
      var newTicket = await zendesk.createTicket(messages[0])
      openTicketId = newTicket.id
      requesterId = newTicket.requester_id
    } catch (err) {
      failedMsgs.push({
        message: messages[0],
        err: err
      })
    }

    // Builds the DynamoDB query
    // INSERT INTO whatsappTicketsTable (wa_id, ticketId, requesterId)
    // VALUES (messages[0].wa_id, newTicket.id, newTicket.requester_id)
    try {
      const params = {
        TableName: process.env.whatsappTicketsTable,
        Item: {
          wa_id: messages[0].wa_id,
          ticketId: newTicket.id,
          requesterId: newTicket.requester_id
        }
      };

      await dynamoDb.put(params).promise()

    } catch (err) {
      console.log("Error creating ticket record");
      throw err
    }

  }
  // If there is an open ticket, updates it with first message
  else if (openTickets.Count == 1) {

    openTicketId = openTickets.Items[0].ticketId
    requesterId = openTickets.Items[0].requesterId

    try {
      await zendesk.updateTicket(openTicketId, requesterId, messages[0])
    } catch (err) {
      failedMsgs.push({
        message: messages[0],
        err: err
      })
    }
  }
  else {
    throw new Error("Multiple open tickets for same wa_id on table whatsapp-tickets")
  }

  // Updates the created ticket with the rest of the messages
  for (var i = 1; i < messages.length; i++) {
    try {
      await zendesk.updateTicket(openTicketId, requesterId, messages[i])
    } catch (err) {
      failedMsgs.push({
        message: messages[i],
        err: err
      })
    }
  }

  return {
    failedMsgs: failedMsgs
  }
}

/*
Marks all recieved messages as handled in DynamoDB
INPUTS:
  - unhandledMsgs: an array of DynamoDB records
OUTPUT:
  - An object like the following with the succsesfully handled messages and the failed ones
  {
    successfulMsgs: [successfulMsgs],
    failedMsgs: [failedMsgs]
  }
*/
async function setMessagesAsHandled(unhandledMsgs) {

  var successfulMsgs = []
  var failedMsgs = []

  // For every message in the input array
  for (var message of unhandledMsgs) {

    // Builds the DynamoDB query
    // UPDATE whatsappMessagesTable SET handled = true, lock = false where wa_id = message.wa_id and msg_id = message.msg_id
    var params = {
      TableName: process.env.whatsappMessagesTable,
      Key: {
        wa_id: message.wa_id,
        msg_id: message.msg_id
      },
      UpdateExpression: 'set #handled = :handledVal, #lock = :lockVal',
      ExpressionAttributeNames: {
        '#handled' : 'handled',
        '#lock': 'lock'
      },
      ExpressionAttributeValues: {
        ':handledVal' : true,
        ':lockVal': false
      }
    };

    try {

      var res = await dynamoDb.update(params).promise()
      console.log("Updated item on DB: ", res);

      successfulMsgs.push(message)
    } catch (err) {

      console.log("Error updating item on DB: ", err);
      failedMsgs.push(message)
    }

  }

  return {
    successfulMsgs: successfulMsgs,
    failedMsgs: failedMsgs
  }
}

/*
Unlocks all messages in DynamoDB
INPUTS:
  - lockedMessages: an array of DynamoDB records
OUTPUT:
  - An object like the following with the succsesfully locked messages and the failed ones
  {
    successfulMsgs: [successfulMsgs],
    failedMsgs: [failedMsgs]
  }
*/
async function unlockMessages(lockedMessages) {

  var successfulMsgs = []
  var failedMsgs = []

  for (var message of lockedMessages) {

    // Builds the DynamoDB query
    // UPDATE whatsappMessagesTable SET lock = false where wa_id = message.wa_id and msg_id = message.msg_id
    var params = {
      TableName: process.env.whatsappMessagesTable,
      Key: {
        wa_id: message.wa_id,
        msg_id: message.msg_id
      },
      UpdateExpression: 'set #lock = :lockVal',
      ExpressionAttributeNames: {
        '#lock': 'lock'
      },
      ExpressionAttributeValues: {
        ':lockVal': false
      }
    };

    try {

      var res = await dynamoDb.update(params).promise()
      console.log("Updated item on DB: ", res);

      successfulMsgs.push(message)
    } catch (err) {

      console.log("Error updating item on DB: ", err);
      failedMsgs.push(message)
    }

  }

  return {
    successfulMsgs: successfulMsgs,
    failedMsgs: failedMsgs
  }
}
