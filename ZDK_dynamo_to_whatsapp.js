/*
  Lambda function executed when the DynamoDB recieves a new message from the Zendesk Webhook
*/

exports.handler = handler

const AWS = require('aws-sdk');
const dynamoDb = new AWS.DynamoDB.DocumentClient();

const whatsapp = require('./whatsappApiMethods.js')

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
    else { // If all events were treated succsesfully, returns a success and the event will not sent again
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

  for (var record of streamRecords) {

    // Handles only events of type INSERT. Ignores the other types (MODIFY, DELETE, etc)
    if (record.eventName != "INSERT") {
      continue
    }

    try {
      // Handle the record individually
      var res = await handleEvent(record)

      console.log("Handled record: ", res);

      // Adds it to the successfulRecords in the response
      successfulRecords.push({
        record: record,
        status: res
      })

    } catch (err) {
      console.log("Error handling record: ", err);

      // If an error occur, adds it to the successfulRecords in the response
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

        console.log("Locked all messages");

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
        return whatsappWrapper(sortedMessages, record.dynamodb.Keys.wa_id.S)
      }

    })
    .then((whatsappResponse) => {

      // If there is an error sending any message, stops execution
      if (whatsappResponse.failedMsgs && whatsappResponse.failedMsgs.length > 0) {
        reject(whatsappResponse)
      } else {
        console.log("Whatsapp response: ", JSON.stringify(whatsappResponse,null,2));

        // On success: sets messages as handled on dynamo and removes lock
        return setMessagesAsHandled(sortedMessages)
      }

    })
    .then((res) => {
      resolve()
    })
    .catch((err) => {

      console.log("Error in handleEvent: ", err);
      console.log("Unlocking messages");

      // On error: unlocks messages on dynamo
      unlockMessages(sortedMessages)
      .then((res) => {
        console.log("Unlocked messages");
        reject(err)
      })
      .catch((err2) => {
        console.log("Error unlocking messages: ", err2);
        reject(err2)
      })

    })

  })
}

/*
Gets all unhandled messages of a contact from DynamoDB
INPUT:
  - phoneNumber: The contact phonenumber in the wa_id format
OUTPUT:
  - An array with all unhandled messages of the contact
*/
function getUnhandledMsgsByPhone(phoneNumber) {
  return new Promise ((resolve, reject) => {

    // Builds the DynamoDB query
    // SELECT * from commentsFromZendeskTable where wa_id = phoneNumber and handled = false and lock = false
    var params = {
      TableName: process.env.commentsFromZendeskTable,
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
      resolve(res.Items)
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
    // UPDATE commentsFromZendeskTable SET lock = true where wa_id = message.wa_id and commentId = message.commentId
    var params = {
      TableName: process.env.commentsFromZendeskTable,
      Key: {
        wa_id: message.wa_id,
        commentId: message.commentId
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
Sends the messages from Zendsk to the WhatsApp API
INPUTS:
  - messages: an array of messages from Zendesk saved in DynamoDB
  - wa_id: the contact phonenumber in the wa_id format
*/
async function whatsappWrapper(messages, wa_id) {

  console.log("In whatsappWrapper: ", JSON.stringify(messages, null, 2));

  var failedMsgs = []

  // For each massage to be sent
  for (var message of messages) {

    try {
      // Sends the text of the message to WhatsApp
      await whatsapp.sendTextMessage(wa_id, message.plain_body)

      // If the message has images attached to it, sends them as a separated images messages to WhatsApp
      // NOTE: A Zendesk ticket might have one or more attachments
      if (message.attachments.length > 0) {
        for (attachment of message.attachments) {
          await whatsapp.sendImageMessage(wa_id, attachment)
        }
      }
    } catch (err) {
      failedMsgs.push({
        message: message,
        err: err
      })
    }
  }

  return {
    failedMsgs: failedMsgs
  }

}

/*
Sets all recieved messages as handled and unlocked in DynamoDB
INPUT:
  - unhandledMsgs: an array of DynamoDB records
OUTPUT:
  - An object like the following with the succsesfully treated messages and the failed ones
  {
    successfulMsgs: [successfulMsgs],
    failedMsgs: [failedMsgs]
  }
*/
async function setMessagesAsHandled(unhandledMsgs) {

  var successfulMsgs = []
  var failedMsgs = []

  for (var message of unhandledMsgs) {

    // Builds the DynamoDB query
    // UPDATE commentsFromZendeskTable SET handled = true, lock = false where wa_id = message.wa_id and commentId = message.commentId
    var params = {
      TableName: process.env.commentsFromZendeskTable,
      Key: {
        wa_id: message.wa_id,
        commentId: message.commentId
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
Sets all recieved messages as unlocked in DynamoDB
INPUT:
  - lockedMessages: an array of DynamoDB records
OUTPUT:
  - An object like the following with the succsesfully treated messages and the failed ones
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
    // UPDATE commentsFromZendeskTable SET lock = false where wa_id = message.wa_id and commentId = message.commentId
    var params = {
      TableName: process.env.commentsFromZendeskTable,
      Key: {
        wa_id: message.wa_id,
        commentId: message.commentId
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
