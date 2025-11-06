import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import { google } from "googleapis";
import fs from "fs";
import 'dotenv/config';
import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config({ path: "./.env" }); // <- or "./environmentals.env" if you kept that filename
import cron from "node-cron";
import fetch from "node-fetch";


// Run reminder job every day at 9 AM
cron.schedule("0 9 * * *", () => {
    console.log("⏰ Running daily reminder check...");
    fetch("https://cutoff-backend-7q70.onrender.com/sendReminders")
      .then(() => console.log("✅ Daily reminders executed"))
      .catch(err => console.error("⚠️ Reminder error:", err));
  });

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {

    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS
  }
});


const app = express();
app.use(cors({
    origin: ["https://cutoffnow.vercel.app", "http://localhost:5500"],
    methods: ["GET,POST,PUT,DELETE"],
    allowedHeaders: ["Content-Type"]
  }));
app.use(bodyParser.json());

// --- Google Auth Setup ---
const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
    
  });
  
  let sheets;
  auth.getClient().then(client => {
    sheets = google.sheets({ version: "v4", auth: client });
  });
  

const SPREADSHEET_ID = "1vypfY9L3HNl3xtWUqjt3fjrr7YwNo7UB35JS9B0vb2I"; // <- change this

// --- ROUTES ---

// Check server is alive
app.get("/", (req, res) => {
  res.send("✅ Cutoff Backend Running");
});

function daysLeft(endDate) {
    const today = new Date();
    const date = new Date(endDate);
    const diff = Math.ceil((date - today) / (1000 * 60 * 60 * 24));
    return diff;
  }
  
// ROUTE: Send Reminders
app.get("/sendReminders", async (req, res) => {
    try {
      const result = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: "Subscriptions!A:G", // now includes column G (userEmail)
      });
  
      const rows = result.data.values;
      if (!rows || rows.length < 2) return res.json({ message: "No data" });
  
      const header = rows[0];
      const data = rows.slice(1);
  
      for (let row of data) {
        const [name, platform, startDate, endDate, email, mobile, userEmail] = row;
  
        const remaining = daysLeft(endDate);
  
        // Only send at exactly 5, 3, or 1 days left
        if (![5, 3, 1].includes(remaining)) continue;
  
        const mailOptions = {
          from: process.env.MAIL_FROM,
          to: userEmail,
          subject: `Reminder: ${name} renews in ${remaining} day(s)!`,
          html: `
          <div style="font-family: Arial; padding: 10px;">
            <h2>Hi there,</h2>
            <p>Your subscription is about to renew:</p>
  
            <ul>
              <li><strong>Subscription:</strong> ${name}</li>
              <li><strong>Platform:</strong> ${platform}</li>
              <li><strong>Start Date:</strong> ${startDate}</li>
              <li><strong>End Date:</strong> ${endDate}</li>
              <li><strong>Email:</strong> ${email}</li>
              <li><strong>Mobile:</strong> ${mobile}</li>
            </ul>
  
            <p><strong>${remaining} day(s) left</strong> until renewal.</p>
  
            <p>Take action if needed 🙂</p>
  
            <br>
            <p>Thank you,</p>
            <p><strong>Cutoff Team</strong></p>
          </div>
          `
        };
  
        await transporter.sendMail(mailOptions);
        console.log(`📧 Sent reminder to: ${userEmail} for: ${name}`);
      }
  
      res.json({ status: "reminders sent" });
  
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to send reminders" });
    }
  });
// Add Subscription
app.post("/addSubscription", async (req, res) => {
  try {
    const { name, platform, startDate, endDate, email, mobile, userEmail } = req.body;

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: "Subscriptions!A:G",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[name, platform, startDate, endDate, email, mobile, userEmail]],
      },
    });

    res.json({ status: "success" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error adding subscription" });
  }
});

// Get Subscriptions (with row number)
app.get("/getSubscriptions", async (req, res) => {
    try {
      const { userEmail } = req.query;
  
      const result = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: "Subscriptions!A:G",
      });
  
      const rows = result.data.values || [];
  
      // Convert to objects and filter by email
      const formatted = rows.slice(1) // skip header
        .map((r, index) => ({
          row: index + 2, // row number in sheet
          name: r[0],
          platform: r[1],
          startDate: r[2],
          endDate: r[3],
          email: r[4],
          mobile: r[5],
          userEmail: r[6]  
        }))
        .filter(r => r.userEmail === userEmail); // filter logged in user
  
      res.json(formatted);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Error retrieving subscriptions" });
    }
  });
  
  

  // Delete Subscription
app.delete("/deleteSubscription/:row", async (req, res) => {
    try {
      const row = req.params.row;
  
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId: 0,
                  dimension: "ROWS",
                  startIndex: row - 1,
                  endIndex: row
                }
              }
            }
          ]
        }
      });
  
      res.json({ status: "deleted" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Delete failed" });
    }
  });
  
  //edit subscription
  app.put("/updateSubscription/:row", async (req, res) => {
    console.log("Updating row:", req.params.row, req.body);

    try {
      const row = req.params.row;
      const { name, platform, startDate, endDate, email, mobile } = req.body;
  
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `Subscriptions!A${row}:G${row}`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[name, platform, startDate, endDate, email, mobile]]
        }
      });
  
      res.json({ status: "updated" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Update failed" });
      
    }
   
  });
  
 

  
  app.get("/sendReminders", async (req, res) => {
    try {
      const result = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: "Subscriptions!A:G",
      });
  
      const rows = result.data.values || [];
      const today = new Date();
  
      rows.slice(1).forEach(r => {
        const name = r[0];
        const endDate = new Date(r[3]);
        const userEmail = r[6];
  
        if (!userEmail || !endDate) return;
  
        const daysLeft = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
  
        if (daysLeft === 3 || daysLeft === 1 || daysLeft === 0) {
          transporter.sendMail({
            from: "Cutoff App <YOUR_GMAIL@gmail.com>",
            to: userEmail,
            subject: `Reminder: ${name} renews in ${daysLeft} day(s)`,
            text: `Heads up! Your subscription for "${name}" ends on ${r[3]}. Cancel or renew soon!`
          });
        }
      });
  
      res.json({ status: "reminders sent" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to send reminders" });
    }
  });
  
  app.get("/testEmail", async (req, res) => {
    try {
      await transporter.sendMail({
        from: process.env.MAIL_FROM,
        to: process.env.MAIL_USER,
        subject: "✅ Nodemailer Test",
        text: "Your email setup works! 🎉"
      });
  
      res.send("Email sent!");
    } catch (err) {
      console.error(err);
      res.status(500).send("Email failed");
    }
  });
  
  
  
// Start server
app.listen(5001, () => console.log("🚀 Backend running on https://cutoff-backend-7q70.onrender.com/"));

