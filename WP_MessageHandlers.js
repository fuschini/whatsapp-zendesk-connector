/*
Helper methods to save Whatsapp new messages to DynamoDB
*/

module.exports = {
  mainHandler: mainHandler
}

/*
Main method - uses the proper handler acording to the message type
INPUTS:
  - message: A message from Whatsapp
  - contact: The object of the Whatsapp contact that sent the message
OUTPUT:
  - If success: a resolved promisse
  - If fail: a rejected promisse with an error
*/
function mainHandler(message, contact) {
  switch (message.type) {
    case 'text':
      return genericMediaHandler(message, contact)

    case 'audio':
      return audioHandler(contact)

    case 'document':
      return genericMediaHandler(message, contact)

    case 'image':
      return genericMediaHandler(message, contact)

    case 'location':
      return genericMediaHandler(message, contact)

    case 'system':
      throw new Error("Unsupported message type")

    case 'video':
      return genericMediaHandler(message, contact)

    case 'voice':
      return genericMediaHandler(message, contact)

    case 'contacts':
      return genericMediaHandler(message, contact)

    default:
      throw new Error("Unknown message type")
  }
}

/*
The handler used for every message type except audio messages. It gets the
information from the message object and puts it into Dynamo
INPUTS:
  - message: A message from Whatsapp
  - contact: The object of the Whatsapp contact that sent the message
OUTPUT:
  - If success: a resolved promisse
  - If fail: a rejected promisse with an error
*/
function genericMediaHandler(message, contact) {
  return new Promise ((resolve, reject) => {

    const AWS = require('aws-sdk');
    const dynamoDb = new AWS.DynamoDB.DocumentClient();

    const params = {
      TableName: process.env.dynamoTable,
      Item: {
        wa_id: contact.wa_id,
        contactName: contact.profile.name,
        timestamp: message.timestamp,
        messageContent: message[message.type],
        type: message.type,
        msg_id: message.id,
        handled: false,
        lock: false,
        tags: ['whatsapp', 'test', message.type]
      },
    };

    dynamoDb.put(params).promise()
    .then((res) => {
      console.log("Created item on DB: ", res);

      resolve({
        status: "OK",
        message: message,
        contact: contact
      })
    })
    .catch((err) => {
      console.log("Error creating item on DB: ", err);

      reject(err)
    })
  })
}

/*
Sends an automatic response saying this number don't support audio messages and
a contact card with another number that the user can send the audio message
NOTE: Keep in mind that audio messages are different from voice messages
INPUTS:
  - contact: The object of the Whatsapp contact that sent the message
OUTPUT:
  - If success: a resolved promisse
  - If fail: a rejected promisse with an error
*/
function audioHandler(contact) {
  return new Promise ((resolve, reject) => {

    const whatsapp = require('./whatsappApiMethods.js')

    // Sends a first text message
    whatsapp.sendTextMessage(contact.wa_id, `_[Automatic message 🤖]_\n\nThis number don't accepts audio messages. If you need to send us one, please do in this other number:`)
    .then((res) => {
      console.log("Sent message to whatsapp", res);

      // Sends a contact card with info from another number
      return whatsapp.sendContactMessage(contact.wa_id, [
        {
          "emails": [{
            "email": "email@yourdomain.com",
            "type": "Email"
  			  }],
      		"name": {
            "first_name": "First name",
            "formatted_name": "Full name",
            "last_name": "Last name"
          },
      		"phones": [{
            "phone": "Formatted number like +99 99 99999-9999",
            "type": "Cellphone",
            "wa_id": "9999999999999"
          }],
  		    "urls": []
  	    }
      ])
    })
    .then((res) => {
      console.log("Sent automatic response message to whatsapp");
      resolve(res)
    })
    .catch((err) => {
      console.log("Error sending message to contact: ", err);
      reject(err)
    })

  })
}
