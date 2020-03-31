/*
  Lambda function executed when a new event arrives from the whatsapp webhook
*/

exports.handler = handler

var wpHandlers = require('./WP_MessageHandlers.js')

/*
Main handler - saves the recieved whatsapp message in DynamoDB
INPUTS:
  - event: an API Gateway event with the body formatted as a WP message event
  - context: lambda standard variable. Not used here
  - callback: callback to the lambda function
OUTPUT:
  - If success: A success event formatted as an API Gateway response
  - If fail: Also a success event formatted as an API Gateway response
    Why? Because the WP webhook keeps re-sending the message if the handlers responds
    with an error. Best practice is to implement a fallback to treat or log
    the unhandled messages in a different way. This is a TODO of the project
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

          // If an known error happens, returns 200 for the WP API but logs which
          // messages were not handled
          if (res.messagesWithError && res.messagesWithError.length > 0) {
            console.log("Finished handling messages with some errors: ", res.messagesWithError);
            console.log("Succeded messages: ", res.handledMessages);

            done(callback, null, 200, "Internal Server Error", { "Content-Type": "text/plain"});
          }
          // If all messages were handled, also returns 200 for the WAPI
          else {
            console.log("Handled messages with no errors: ", JSON.stringify(res,null,2));

            done(callback, null, 200, "OK", { "Content-Type": "text/plain"});
          }

        })
        .catch((err) => {
          // If an unknown error happens, logs only the error and returns
          // a 200 for the WP API
          console.log("Error in handleEvent: ", err);
          done(callback, null, 200, "Bad Request", { "Content-Type": "text/plain"});
        })

      } else {
        // Sending 200 to avoid webhook loop
        done(callback, null, 200, "Event not handled", { "Content-Type": "text/plain"});
      }
      break;
    case 'OPTIONS':
      done(callback, null, 200, null) // This does the CORS magic
      break;
    default:
      done(callback, null, 200, "Method Not Allowed", { "Content-Type": "text/plain"});
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

// Validates if WP webhook event is valid
function validParams(event) {

  // Tests for the contact array
  if (typeof event.contacts == "undefined" || event.contacts.length != 1) {
    console.log("Missing contacts node in request");
    return false
  }

  // Tests for the contact object fields
  if (typeof event.contacts[0].profile == "undefined" || typeof event.contacts[0].profile.name == "undefined" || typeof event.contacts[0].wa_id == "undefined") {
    console.log("Missing some contact field in request");
    return false
  }

  // Tests for the messages array
  if (typeof event.messages == "undefined") {
    console.log("Missing messages node in request");
    return false
  }

  // Tests for common fields from every message object
  for (message of event.messages) {
    if (typeof message.from == "undefined" || typeof message.id == "undefined" || typeof message.timestamp == "undefined" || typeof message.type == "undefined") {
      console.log("A message is missing a common property in request");
      return false
    }
  }

  return true
}

/*
Saves all new messages in DynamoDB
INPUT:
  - event: the API Gateway event recieved in the Main Handler
OUTPUT:
  - An object like the one below
  {
    handledMessages: [an array of suscessfully handled messages],
    messagesWithError: [an array of failed messages]
  }
*/
async function handleEvent(event) {

  var messagesWithError = []
  var handledMessages = []

  // Calls the mainHandler method for each message recieved puts the response in
  // the handledMessages or messagesWithError of the response
  for (message of event.messages) {
    try {
      var handlerResponse = await wpHandlers.mainHandler(message, event.contacts[0])

      handledMessages.push(handlerResponse)

    } catch (err) {

      messagesWithError.push({
        message: message,
        error: err
      })
    }
  }

  return {
    handledMessages: handledMessages,
    messagesWithError: messagesWithError
  }
}
