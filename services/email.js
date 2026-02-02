import nodemailer from "nodemailer";
import { getPool } from "../utils/db.js";

let transporter = null;

const getTransporter = () => {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const secure = process.env.SMTP_SECURE === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  // console.log(`[email] creating transporter host=${host} port=${port} secure=${secure} user=${user}`);

  if (!host || !user || !pass) {
    console.error(`[email] SMTP config incomplete: host=${!!host} user=${!!user} pass=${!!pass}`);
    throw new Error("SMTP configuration incomplete");
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
  });

  // console.log(`[email] transporter created successfully`);
  return transporter;
};

export const getEmailTemplate = async (shop, templateKey) => {
  const pool = getPool();

  // console.log(`[email] fetching template shop=${shop} key=${templateKey}`);

  const [rows] = await pool.execute(
    `SELECT template_key, title, subject, html, calendar_id
     FROM email_templates
     WHERE shop = ? AND template_key = ?
     LIMIT 1`,
    [shop, templateKey]
  );

  if (!rows.length) {
    console.error(`[email] template NOT FOUND shop=${shop} key=${templateKey}`);
    return null;
  }

  // console.log(`[email] template found shop=${shop} key=${templateKey} subject="${rows[0].subject}"`);
  return rows[0];
};

const replaceVariables = (text, variables) => {
  if (!text) return text;

  let result = text;
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    const regex = new RegExp(placeholder.replace(/[{}]/g, "\\$&"), "g");
    result = result.replace(regex, value || "");
  }

  return result;
};

export const sendTemplateEmail = async (shop, templateKey, toEmail, variables = {}) => {
  // console.log(`[email] sendTemplateEmail shop=${shop} template=${templateKey} to=${toEmail}`);
  // console.log(`[email] variables: ${JSON.stringify(variables)}`);

  const template = await getEmailTemplate(shop, templateKey);

  if (!template) {
    throw new Error(`Email template not found: ${templateKey}`);
  }

  const subject = replaceVariables(template.subject, variables);
  const html = replaceVariables(template.html, variables);

  // console.log(`[email] prepared subject="${subject}"`);

  const transport = getTransporter();
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;

  const mailOptions = {
    from,
    to: toEmail,
    subject,
    html,
  };

  // console.log(`[email] sending email from=${from} to=${toEmail}`);

  try {
    const info = await transport.sendMail(mailOptions);

    // console.log(`[email] EMAIL SENT messageId=${info.messageId} response=${info.response}`);

    return {
      success: true,
      messageId: info.messageId,
      response: info.response,
    };
  } catch (err) {
    console.error(`[email] SEND FAILED to=${toEmail}:`, err.message);
    throw err;
  }
};

export const sendEmail = async (toEmail, subject, html, from = null) => {
  // console.log(`[email] sendEmail to=${toEmail} subject="${subject}"`);

  const transport = getTransporter();
  const sender = from || process.env.MAIL_FROM || process.env.SMTP_USER;

  const mailOptions = {
    from: sender,
    to: toEmail,
    subject,
    html,
  };

  try {
    const info = await transport.sendMail(mailOptions);

    // console.log(`[email] EMAIL SENT messageId=${info.messageId}`);

    return {
      success: true,
      messageId: info.messageId,
      response: info.response,
    };
  } catch (err) {
    console.error(`[email] SEND FAILED to=${toEmail}:`, err.message);
    throw err;
  }
};

export const verifyConnection = async () => {
  // console.log(`[email] verifying SMTP connection`);

  try {
    const transport = getTransporter();
    await transport.verify();
    // console.log(`[email] SMTP connection verified successfully`);
    return true;
  } catch (err) {
    console.error(`[email] SMTP verification failed:`, err.message);
    return false;
  }
};
