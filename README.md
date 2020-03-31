# WhatsApp <> Zendesk Connector

## Read this before anything else!

For this integration to work, you need to have your instance of the **WhatsApp API up and running**.

If you want to understand more about the project you can check out this article covering its architecture, project decisions and some other general topics:

[Check the article here](https://medium.com/@hfuschini/the-free-whatsapp-zendesk-integration-youve-been-waiting-for-41a63a2c1ce2?sk=1b4e3687c3b953affeae9571e9e7b252).

Last but not least, this was a very complicated project to document due to its many different components.

It's a working in progress. If you ever get stuck trying to use it, open an issue and I **will** get back to you. I want you to be succsesfull when using this project :)

## Getting started

### Install all you'll need

1. If you don't have it already, install the [AWS CLI](https://aws.amazon.com/cli/). The serverless framework will use it to do its magic.

2. Install the [serverless framework CLI](https://serverless.com/) and [configure the AWS credentials](https://serverless.com/framework/docs/providers/aws/cli-reference/config-credentials/) for it.

### Create the resources you'll use

1. `whatsapp_messages` DynamoDB table with the primary key `wa_id` and the sorting key `msg_id`

2. `zendesk_messages` DynamoDB table with primary key `wa_id` and sorting key `commentId`

3. `open_tickets` DynamoDB table with primary key `wa_id` and no sorting key

Once created the tables, you need to enable the Stream for the first two like this:

![Manage Stream](screenshots/manage_stream.png)

![Enable Stream](screenshots/enable_stream.png)

After creating the streams, copy the **Latest stream ARN**. You'll need for the next step.

4. Create an **AWS S3 bucket** to store the audio files you receive from WhatsApp. It doesn't matter the name of the bucket, but you'll need it on the next step.

5. Optionally, you may create an **AWS IAM Role** with all the permissions your lambdas will need and use it's ARN in the next step.

If you don't want to create the role manually, you can configure the lambda permissions in the `serverless.yml` file as shown in [this article](https://serverless.com/framework/docs/providers/aws/guide/iam/).

### Set your environment variables

Copy the `envvars.dist` file renaming it to `envvars.json` and fill all the values in it. Here's the description of everything you'll need:

```json
{
  "generalRole": "the ARN of the general IAM role you created",
  "zendeskApiBaseUrl": "base URL of your Zendesk API",
  "zendeskUser": "email of the zendesk user you'll use to auth the API",
  "zendeskPwd": "password of the user you'll use to auth the API",
  "zendeskToken": "a Zendesk API token ",
  "whatsappMessagesTable": "the name of the whatsapp_messages table on Dynamo",
  "whatsappMessagesTableStreamArn": "ARN of the Stream you created for the whatsapp_messages",
  "whatsappTicketsTable": "the name of the open_tickets table on Dynamo",
  "commentsFromZendeskTable": "the name of zendesk_messages table on Dynamo",
  "commentsFromZendeskTableStreamArn": "ARN of the Stream you created for the zendesk_messages",
  "whatsappUser": "username for the admin user of your WhatsApp API",
  "whatsappPwd": "password for the admin user of your WhatsApp API",
  "whatsappBaseUrl": "base URL for your WhatsApp API",
  "whatsappMediaBucket": "the name of the bucket you created to store the audio messages"
}
```

### First deploy

Run the command `sls dpeloy -s <stage>` with `<stage>` being the stage you want to deploy to.

By the end of the deploy, the framework CLI will output a URL from which your API is available.

Copy this URL, you'll need it.

### Configure the webhook on WhatsApp API

Your WhatsApp API will have a `PATCH /settings/application` endpoint from which you can update the settings of your API, including setting a webhook URL you want the API to send new events to.

Set the webhook to the endpoint in your API that ends with `whatsapp-webhook` putting it on the webhook url node in the request body.

Make the request and the response should have the new settings already with the new webhook.

### Configure the webhook on Zendesk

You also need to configure Zendesk to send you a webhook when a ticket with the tag `Whatsapp` gets updated with a response from a Zendesk agent.

1. Create a webhook with a HTTP target following the instructions on [this link](https://support.zendesk.com/hc/en-us/articles/204890268-Creating-webhooks-with-the-HTTP-target)

> For the name of your webhook use `Whatsapp Integration` and in the Url field use the endpoint of the integration that ends with `/zendesk/webhook`

2. Go to Settings > Triggers on the Zendesk Zupport UI and select **Add trigger**

3. Configure your **Conditions** section so it looks like this:

![zendesk_trigger_conditions](/screenshots/zendesk_trigger_conditions.png)

4. Configure your **Actions** section so it looks like this:

![zendesk_webhook_actions](/screenshots/zendesk_webhook_actions.png)

5. Finish hitting Save

## Testing the functions

You can run the functions of the integration locally with:

```
serverless invoke local -f <function> -p <path_to_test_file>
```

Where `function` is the name of the function as in the function node on `serverless.yml` file and `path_to_test_file` is the path to the file you want to use as input.

> I sugest you copy some of the input objects sent to Dynamo Streams, WhatsApp Webhooks and Zendesk Webhooks to a local folder to use them as inputs for your local tests.

## Deploying the service

After making sure your functions work locally. Simply run:

```
serverless deploy -s <stage>
```

Where `stage` is the deployment stage you want. The stage is going to be used as a sufix in all functions names.

And you should be good to go!
