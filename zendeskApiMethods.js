/*
Helper methods to interface with the Zendesk API using different modules
*/
const zendeskApi = require('node-zendesk');
const axios = require('axios')
const request = require('request')

module.exports = {
  showTicket: showTicket,
  createTicket: createTicket,
  updateTicket: updateTicket,
  getTicketComments: getTicketComments,
  listTickets: listTickets,
  uploadFile: uploadFile
}

var zendesk = zendeskApi.createClient({
  username:  process.env.zendeskUser,
  token:     process.env.zendeskToken,
  remoteUri: `${process.env.zendeskApiBaseUrl}/api/v2`
});

function createTicket(messageObj) {
  return new Promise ((resolve, reject) => {

    const zdkNormalizer = require('./ZDK_MessageHandlers.js')

    console.log("In create ticket: ", messageObj);

    var createBody = {
      "ticket": {
        "subject":  `Whatsapp ${messageObj.wa_id} - ${messageObj.contactName}`,
        "requester": { "name": messageObj.contactName, "email": `${messageObj.wa_id}@whatsappddh.com` },
        "tags": ["whatsapp"]
      }
    }

    zdkNormalizer.prepTicketBody(messageObj, createBody)
    .then((createBody) => {
      console.log("createBody: ", createBody);

      zendesk.tickets.create(createBody, function (err, req, res) {
        if (err) {
          console.log("Error creating ticket", err);
          reject(err)
        }

        console.log("created ticket: ", JSON.stringify(res, null, 2));
        resolve(res)
      });
    })
    .catch((err) => {
      console.log(err);
      reject(err)
    })


  })
}

function updateTicket(ticketId, requesterId, messageObj) {
  return new Promise ((resolve, reject) => {

    const zdkNormalizer = require('./ZDK_MessageHandlers.js')

    console.log("In update ticket: ", messageObj, ticketId);

    var updateBody = {
      "ticket": {
        "status":  "open"
      }
    }

    zdkNormalizer.prepTicketBody(messageObj, updateBody)
    .then((updateBody) => {

      if (updateBody.ticket.comment) {
        updateBody.ticket.comment.author_id = requesterId
      } else if (updateBody.ticket.voice_comment) {
        updateBody.ticket.voice_comment.author_id = requesterId
      }

      console.log("updateBody: ", updateBody);

      zendesk.tickets.update(ticketId, updateBody, function (err, req, res) {
        if (err) {
          console.log("Error updating ticket", err);
          reject(err)
        }

        console.log("Updated ticket: ", JSON.stringify(res, null, 2));
        resolve(res)
      });

    })
    .catch((err) => {
      console.log(err);
      reject(err)
    })

  })
}

function showTicket(ticketId) {
  return new Promise ((resolve, reject) => {

    zendesk.tickets.show(ticketId, function (err, req, res) {
      if (err) {
        reject(err)
      }

      resolve(res)
    });
  })
}

function listTickets(ticketId) {
  return new Promise ((resolve, reject) => {

    zendesk.tickets.list(ticketId, function (err, req, res) {
      if (err) {
        reject(err)
      }

      resolve(res)
    });
  })
}

// Use raw http request to pass the querystring parameters
function getTicketComments(ticketId) {

  return axios.get(`${process.env.zendeskApiBaseUrl}/api/v2/tickets/${ticketId}/comments.json?sort_order=desc&include_inline_images=true`, {
    auth: {
      username: process.env.zendeskUser,
      password: process.env.zendeskPwd
    }
  })

}

// Uses request module instead of node-zendesk
function uploadFile(fileBlob, filename) {
  return new Promise ((resolve, reject) => {

    var options = { method: 'POST',
      url: `${process.env.zendeskApiBaseUrl}/api/v2/uploads.json`,
      qs: { filename: filename },
      headers:
       { Authorization: 'Basic bWFyaS5sYWNlcmRhQGRlbnRyb2RhaGlzdG9yaWEuY29tLmJyOnlxTSY0WHlRMnE=',
         'Content-Type': 'application/binary;' },
      body: fileBlob
    };

    request(options, function (error, response, body) {
      if (error) reject(error)

      resolve(JSON.parse(body))
    });

 })

}
