/*
  Lambda function executed when a new event arrives from the Zendesk webhook
*/

exports.handler = handler

const zendesk = require('./zendeskApiMethods.js')

const AWS = require('aws-sdk');
const dynamoDb = new AWS.DynamoDB.DocumentClient();

/*
Main handler - saves the recieved ticket comment in DynamoDB
INPUTS:
  - event: an API Gateway event with the body formatted in the Zendesk Webhook
  - context: lambda standard variable. Not used here
  - callback: callback to the lambda function
OUTPUT:
  - If success: A success event formatted as an API Gateway response
  - If fail: Also a success event formatted as an API Gateway response
    Why? Because The Zendesk webhook doesn't re-send failed messages if you respond with an error
    In fact, if a webhook gets too much error responses, Zendesk disables it and you need to be manually enable it again
*/
function handler (event, context, callback) {
  context.callbackWaitsForEmptyEventLoop = false;

  switch (event.httpMethod) {
    case 'POST':

      var body = JSON.parse(event.body)
      console.log("Recieved body: ", JSON.stringify(body, null, 2));

      // Validates request in separeted method
      if (validParams(body)) {

        // Handles event
        handleEvent(body)
        .then((res) => {

          console.log("Handled messages with no errors: ", JSON.stringify(res,null,2));

          // Sends event with status 200 if the event was successfully handled
          done(callback, null, 200, "OK", { "Content-Type": "text/plain"});

        })
        .catch((err) => {
          console.log("Error: ", err);

          // Sends event with status 200 in case of error
          done(callback, null, 200, "Internal Server Error", { "Content-Type": "text/plain"});
        })

      } else {
        // Sends event with status 200 in case of error
        done(callback, null, 200, "Bad Request", { "Content-Type": "text/plain"});
      }

      break;
    case 'OPTIONS':
      done(callback, null, 200, null) // This does the CORS magic
      break;
    default:
      done(callback, null, 405, "Method Not Allowed", { "Content-Type": "text/plain"});
  }
};

/*
Wrapper method for the callback
*/
function done (callback, err, statusCode, body, customHeaders) {

  callback(null, {
    statusCode: err ? 500 : statusCode,
    body: err ? err.message : body,
    headers: customHeaders ? customHeaders : {
        'Content-Type': 'application/json',
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Allow-Methods": "OPTIONS,POST,GET"
    }
  })
}

// Validates if the event from Zendesk webhook is valid
function validParams(event) {

  // Tests for the ticketId property
  if (typeof event.ticketId == "undefined") {
    console.log("Missing ticketId node in request");
    return false
  }

  // Tests for the messages array
  if (typeof event.requesterEmail == "undefined") {
    console.log("Missing requesterEmail node in request");
    return false
  }

  return true
}

/*
Saves all new ticket's comments of an agent in DynamoDB
INPUT:
  - event: the API Gateway event recieved in the Main Handler
OUTPUT:
  - If success: a resolved promisse
  - If fail: a rejected promisse with an error
*/
function handleEvent(event) {
  return new Promise ((resolve, reject) => {

    // Gets the requester phonenumber (wa_id) from the email associated with the zendesk ticket
    // This email is generated automatically as <wa_id>@yourdomain.com
    var requesterPhoneNumber = event.requesterEmail.split("@")[0]

    let commentsFromZendesk
    let commentsFromDb

    // Gets all ticket's comments from Zendesk API
    zendesk.getTicketComments(event.ticketId)
    .then((res) => {
      console.log("ticketComments: ", JSON.stringify(res.data,null,2));

      // Filter only the comments created by an Zendesk agent using the web UI
      var agentComments = res.data.comments.filter((comment) => {
        return comment.via.channel == "web" // Requester comments are from channel 'api'
      })

      console.log("agent comments: ", JSON.stringify(agentComments,null,2));

      commentsFromZendesk = agentComments

      // Gets comments associated with requester phonenumber from DynamoDB
      return getCommentsFromDb(requesterPhoneNumber)

    })
    .then((res) => {

      console.log("Got comments from DB: ", JSON.stringify(res,null,2));

      commentsFromDb = res.Items

      // Compares the agent comments from the ticket with the comments from DB to filter the new ones
      var newComments = []
      for (var zdkComment of commentsFromZendesk) {
        if (typeof commentsFromDb.find((dbComment) => { return dbComment.commentId == zdkComment.id }) == "undefined" ) {
          newComments.push(zdkComment)
        }
      }

      console.log("newComments after filter: ", JSON.stringify(newComments,null,2));

      if (newComments.length == 0) {
        return new Promise ((resolve, reject) => {
          resolve("No new comments")
        })
      } else {
        // Save new comments in DB
        return putComment(newComments, requesterPhoneNumber)
      }
    })
    .then((res) => {

      console.log("Put comments in DB: ", JSON.stringify(res,null,2));

      resolve("OK")
    })
    .catch((err) => {
      reject(err)
    })

  })

}

/*
Gets comments associated with a phonenumber from DynamoDB
INPUT:
  - wa_id: the requester phonenumber
OUTPUT:
  - A promise of the call to the DynamoDB API
*/
function getCommentsFromDb(wa_id) {

  // DynamoDB query
  // SELECT * FROM commentsFromZendeskTable WHERE wa_id = wa_id
  var params = {
    TableName: process.env.commentsFromZendeskTable,
    ConsistentRead: true,
    KeyConditionExpression: "wa_id = :wa_id",
    ExpressionAttributeValues : {
      ":wa_id": wa_id
    }
  };

  return dynamoDb.query(params).promise()
}

/*
Inserts a new record in the commentsFromZendeskTable in DynamoDB
INPUTS:
  - newComments: an array of comments from Zendesk
  - phoneNumber: the requester phonenumber
OUTPUT:
  - A promise of the call to the DynamoDB API
*/
function putComment(newComments, phoneNumber) {

  var requests = []
  for (comment of newComments) {

    var requestTemplate = {
      PutRequest: {
        Item: {
          wa_id: phoneNumber,
          commentId: comment.id.toString(),
          author_id: comment.author_id,
          body: comment.body,
          plain_body: comment.plain_body,
          attachments: comment.attachments,
          timestamp: new Date(comment.created_at).getTime().toString(),
          handled: false,
          lock: false
        }
      }
    }

    requests.push(requestTemplate)
  }

  // DynamoDB query
  // INSERT INTO commentsFromZendeskTable
  // ('wa_id', 'commentId', 'author_id', body, plain_body, attachments, timestamp, handled, lock)
  // VALUES
  // (...), ... , (...)
  var params = {
    RequestItems: {}
  }

  params.RequestItems[process.env.commentsFromZendeskTable] = requests

  console.log("batchWrite params: ", JSON.stringify(params,null,2));

  return dynamoDb.batchWrite(params).promise()
}
