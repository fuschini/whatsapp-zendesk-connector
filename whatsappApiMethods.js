/*
Helper methods to interface with the Whatsapp API using different modules
*/
const axios = require('axios')
const https = require('https')
const request = require('request')

module.exports = {
  loginAdmin: loginAdmin,
  sendTextMessage: sendTextMessage,
  sendImageMessage: sendImageMessage,
  downloadMedia: downloadMedia,
  downloadMediaRequest: downloadMediaRequest,
  sendContactMessage: sendContactMessage
}

// Gets a log-in token using the user and password stored as env vars
function loginAdmin() {

  return axios.post(`${process.env.whatsappBaseUrl}/v1/users/login`, {
	  "new_password": process.env.whatsappPwd
  }, {
    auth: {
      username: process.env.whatsappUser,
      password: process.env.whatsappPwd
    },
    httpsAgent: new https.Agent({
      rejectUnauthorized: false
    })
  })
}

/*
Sends a text message to the Whatsapp API
OUTPUT:
  - A pending promise from the axios request
*/
function sendTextMessage(phoneNumber, textBody) {
  return new Promise ((resolve, reject) => {

    // Gets an auth token
    loginAdmin()
    .then((res) => {

      // Pre-process msg body with custom function
      textBody = cleanText(textBody)

      // Sends it to the API
      return axios.post(`${process.env.whatsappBaseUrl}/v1/messages`, {
        "to": phoneNumber,
        "type": "text",
        "recipient_type": "individual",
        "text": {
          "body": textBody
        }
      },
      {
        headers: {
          Authorization: `Bearer ${res.data.users[0].token}`
        },
        httpsAgent: new https.Agent({
          rejectUnauthorized: false
        })
      })

    })
    .then((res) => {
      resolve(res.data)
    })
    .catch((err) => {
      console.error("Error sending message: ", err);
      reject(err)
    })
  })
}

// Custom aux function to remove unwanted characters from the message text
function cleanText(txt) {
  txt = txt.replace(/&nbsp;/g, " ")

  return txt
}

function sendContactMessage(phoneNumber, contactsArray) {
  return new Promise ((resolve, reject) => {

    loginAdmin()
    .then((res) => {

      return axios.post(`${process.env.whatsappBaseUrl}/v1/messages`, {
        "to": phoneNumber,
        "type": "contacts",
        "recipient_type": "individual",
        "contacts": contactsArray
      },
      {
        headers: {
          Authorization: `Bearer ${res.data.users[0].token}`
        },
        httpsAgent: new https.Agent({
          rejectUnauthorized: false
        })
      })

    })
    .then((res) => {
      resolve(res.data)
    })
    .catch((err) => {
      console.error("Error sending message: ", err);
      reject(err)
    })
  })
}

function sendImageMessage(phoneNumber, attachmentObj) {
  return new Promise ((resolve, reject) => {

    loginAdmin()
    .then((res) => {

      return axios.post(`${process.env.whatsappBaseUrl}/v1/messages`, {
        "to": phoneNumber,
        "type": "image",
        "recipient_type": "individual",
        "image": {
      		"link": attachmentObj.content_url
      	}
      },
      {
        headers: {
          Authorization: `Bearer ${res.data.users[0].token}`
        },
        httpsAgent: new https.Agent({
          rejectUnauthorized: false
        })
      })

    })
    .then((res) => {
      resolve(res.data)
    })
    .catch((err) => {
      console.error("Error sending message: ", err);
      reject(err)
    })
  })
}

function downloadMedia(mediaId) {
  return new Promise ((resolve, reject) => {

    loginAdmin()
    .then((res) => {

      return axios.get(`${process.env.whatsappBaseUrl}/v1/media/${mediaId}`,
      {
        headers: {
          Authorization: `Bearer ${res.data.users[0].token}`
        },
        httpsAgent: new https.Agent({
          rejectUnauthorized: false
        })
      })

    })
    .then((res) => {
      resolve(res)
    })
    .catch((err) => {
      console.error("Error downloading media: ", err);
      reject(err)
    })
  })
}

function downloadMediaRequest(mediaId) {
  return new Promise ((resolve, reject) => {

    loginAdmin()
    .then((res) => {

      var options = { method: 'GET',
        url: `${process.env.whatsappBaseUrl}/v1/media/${mediaId}`,
        rejectUnauthorized : false,
        encoding: null,
        headers: {
          'cache-control': 'no-cache',
           Connection: 'keep-alive',
           Host: 'waent-lb-1515150921.us-east-1.elb.amazonaws.com',
           'Cache-Control': 'no-cache',
           Accept: '*/*',
           Authorization: `Bearer ${res.data.users[0].token}`,
           'Content-Type': 'application/json'
         }
        };

      request(options, function (error, response, body) {
        if (error) {
          console.error("Error downloading media: ", error)
          reject(error)
        }

        resolve({response: response, body: body})
      });
    })
  })
}
