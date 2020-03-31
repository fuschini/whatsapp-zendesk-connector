/*
Helper methods to build requests body to Zendesk API for different message types
*/

module.exports = {
  prepTicketBody: prepTicketBody
}

const AWS = require('aws-sdk');
const s3 = new AWS.S3();

const whatsapp = require('./whatsappApiMethods.js')

/*
Main method - uses the proper handler acording to the message type
INPUTS:
  - wpMessage: A message from Whatsapp
  - zdkBody: The object that will be used as body in the reques to the Zendesk API
OUTPUT:
  - The final zdkBody ready to be sent to the Zendesk API
*/
function prepTicketBody(wpMessage, zdkBody) {
  switch (wpMessage.type) {
    case 'text':
      return prepTextBody(wpMessage, zdkBody)

    case 'audio':
      return prepAudioBody(wpMessage, zdkBody)

    case 'document':
      return prepDocBody(wpMessage, zdkBody)

    case 'image':
      return prepImageBody(wpMessage, zdkBody)

    case 'location':
      return prepLocationBody(wpMessage, zdkBody)

    case 'system':
      throw new Error("Unsupported message type")

    case 'video':
      return prepVideoBody(wpMessage, zdkBody)

    case 'voice':
      return prepVoiceBody(wpMessage, zdkBody)

    case 'contacts':
      return prepContactsBody(wpMessage, zdkBody)

    default:
      throw new Error("Unknown message type")
  }
}

// Text message handler
// Adds the message text as a new comment in the ticket
function prepTextBody(wpMessage, zdkBody) {
  return new Promise ((resolve, reject) => {
    zdkBody.ticket.comment = { "body": wpMessage.messageContent.body }

    resolve(zdkBody)
  })
}

// Image message handler
// Adds the image as an attachment in the new ticket's comment
function prepImageBody(wpMessage, zdkBody) {
  return new Promise ((resolve, reject) => {

    // Downloads the image from the WhatsApp API
    whatsapp.downloadMediaRequest(wpMessage.messageContent.id)
    .then((res) => {
      const zendesk = require('./zendeskApiMethods.js')

      // Uploads the image to Zendesk (it'll be hosted in the Zendesk servers)
      return zendesk.uploadFile(res.body, `${wpMessage.messageContent.id}.jpg`)
    })
    .then((res) => {

      // If the image has a caption in the msg, adds it as the text of the comment
      if (wpMessage.messageContent.caption) {
        zdkBody.ticket.comment = { body: wpMessage.messageContent.caption }
      } else {
        zdkBody.ticket.comment = { body: "Message with no text (see attachment)"}
      }

      // Use the Zendesk upload token to attach the image in the comment
      zdkBody.ticket.comment.uploads = [res.upload.token]

      resolve(zdkBody)
    })
    .catch((err) => {
      console.log(err);
      reject(err)
    })
  })
}

// Video message handler
// Adds the video as an attachment in the new ticket's comment
function prepVideoBody(wpMessage, zdkBody) {
  return new Promise ((resolve, reject) => {

    // Downloads the video from the WhatsApp API
    whatsapp.downloadMediaRequest(wpMessage.messageContent.id)
    .then((res) => {
      const zendesk = require('./zendeskApiMethods.js')

      // Uploads the video to Zendesk (it'll be hosted in the Zendesk servers)
      return zendesk.uploadFile(res.body, `${wpMessage.messageContent.id}.mp4`)
    })
    .then((res) => {

      // If the video has a caption in the msg, adds it as the text of the comment
      if (wpMessage.messageContent.caption) {
        zdkBody.ticket.comment = { body: wpMessage.messageContent.caption }
      } else {
        zdkBody.ticket.comment = { body: "Message with no text (see attachment)"}
      }

      // Use the Zendesk upload token to attach the image in the comment
      zdkBody.ticket.comment.uploads = [res.upload.token]

      resolve(zdkBody)
    })
    .catch((err) => {
      console.log(err);
      reject(err)
    })
  })
}

// Voice message handler
// Uploads the voice record in a AWS S3 bucket and creates a new comment in the ticket with its URL
function prepVoiceBody(wpMessage, zdkBody) {
  return new Promise ((resolve, reject) => {

    // Downloads the voice record from WhatsApp API
    whatsapp.downloadMediaRequest(wpMessage.messageContent.id)
    .then((res) => {

      // Uploads it to AWS S3
      return putFileInS3(`${wpMessage.wa_id}-${wpMessage.messageContent.id}.ogg`, res.body)
    })
    .then((res) => {

      // Builds the ticket's comment text with the URL of the uploaded record
      zdkBody.ticket.comment = { body: `This is an audio message. Download it from:\nhttps://s3.amazonaws.com/${process.env.whatsappMediaBucket}/${wpMessage.wa_id}-${wpMessage.messageContent.id}.ogg`}

      resolve(zdkBody)
    })
    .catch((err) => {
      console.log(err);
      reject(err)
    })
  })
}

// Audio message handler
// Uploads the audio record in a AWS S3 bucket and creates a new comment in the ticket with its URL
function prepAudioBody(wpMessage, zdkBody) {
  return new Promise ((resolve, reject) => {

    // Downloads the audio record from WhatsApp API
    whatsapp.downloadMediaRequest(wpMessage.messageContent.id)
    .then((res) => {

      // Uploads it to AWS S3
      return putFileInS3(`${wpMessage.wa_id}-${wpMessage.messageContent.id}.mpeg`, res.body)
    })
    .then((res) => {

      // Builds the ticket's comment text with the URL of the uploaded record
      zdkBody.ticket.comment = { body: `This is an audio message. Download it from:\nhttps://s3.amazonaws.com/${process.env.whatsappMediaBucket}/${wpMessage.wa_id}-${wpMessage.messageContent.id}.mpeg`}

      resolve(zdkBody)
    })
    .catch((err) => {
      console.log(err);
      reject(err)
    })
  })
}

// Contact card message
// Converts the contact info to text and adds a new comment in the ticket
function prepContactsBody(wpMessage, zdkBody) {
  return new Promise ((resolve, reject) => {

    var formattedBody = "This message is a Contact Card:"

    // Contact cards can have multiple contacts. Iterates over all of them building the comment text
    for (var contact of wpMessage.messageContent) {
      var contactCardText = `\n\nNome: ${contact.name.formatted_name}\n`

      for (var phone of contact.phones) {
        contactCardText += `${phone.type}: ${phone.phone}`
      }

      formattedBody += contactCardText
    }

    zdkBody.ticket.comment = { "body": formattedBody }

    resolve(zdkBody)
  })

}

// Location message handler
// Converts the location info to text and adds a new comment in the ticket
function prepLocationBody(wpMessage, zdkBody) {
  return new Promise ((resolve, reject) => {

    var formattedBody = `This message is a location:\n\n`

    if (wpMessage.messageContent.name) {
      formattedBody += `Name of the place: ${wpMessage.messageContent.name}\n`
    }

    if (wpMessage.messageContent.address) {
      formattedBody += `Address: ${wpMessage.messageContent.address}\n`
    }

    formattedBody += `See on Google Maps: https://www.google.com/maps/?q=${wpMessage.messageContent.latitude},${wpMessage.messageContent.longitude}`

    zdkBody.ticket.comment = { "body": formattedBody }

    resolve(zdkBody)
  })

}

// Document message handler
// Adds the document as an attachment in the new ticket's comment
function prepDocBody(wpMessage, zdkBody) {
  return new Promise ((resolve, reject) => {

    // Download the document from the WhatsApp API
    whatsapp.downloadMediaRequest(wpMessage.messageContent.id)
    .then((res) => {
      const zendesk = require('./zendeskApiMethods.js')

      // Uploads it to the Zendesk API
      return zendesk.uploadFile(res.body, wpMessage.messageContent.filename)
    })
    .then((res) => {

      // If the document has a caption in the msg, adds it as the text of the comment
      if (wpMessage.messageContent.caption) {
        zdkBody.ticket.comment = { body: wpMessage.messageContent.caption }
      } else {
        zdkBody.ticket.comment = { body: "Message with no text (see attachment)"}
      }

      // Use the Zendesk upload token to attach the image in the comment
      zdkBody.ticket.comment.uploads = [res.upload.token]

      resolve(zdkBody)
    })
    .catch((err) => {
      console.log(err);
      reject(err)
    })
  })
}

// Helper method to upload files to AWS S3 using AWS SDK
function putFileInS3(mediaId, content) {
    return new Promise ((resolve, reject) => {
        var src_bkt = process.env.whatsappMediaBucket

        s3.putObject({
            Bucket: src_bkt,
            Key: mediaId,
            Body: content,
            ACL: "public-read"
        }, function(err, data) {
            if (err) {
                console.log("Error on putting file in bucket with fileName = " + fileName);
                console.log(err, err.stack);
                reject(err.message);
            } else {
                console.log("Put file in bucket")
                resolve(data)
            }
        });
    })
}
