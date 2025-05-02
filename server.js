import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import { MongoClient, ServerApiVersion } from 'mongodb';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

let db, bookings;

// Connect once when server starts
client.connect()
  .then(() => {
    db = client.db("mariastudio"); // You can change the DB name if needed
    bookings = db.collection("bookings");
    console.log("✅ Connected to MongoDB Atlas");
  })
  .catch((err) => {
    console.error("❌ MongoDB connection failed:", err);
  });


// ✅ POST: Save new booking
app.post('/submit-booking', async (req, res) => {
  try {
    const bookingData = { ...req.body, date: new Date().toISOString() };
    const result = await bookings.insertOne(bookingData);

    // ✉️ Send email notification
    await sendBookingNotification(bookingData);

    res.json({ message: 'Booking saved', id: result.insertedId });
  } catch (err) {
    console.error('❌ Failed to insert booking or send email:', err);
    res.status(500).json({ error: 'Failed to save booking' });
  }
});


// ✅ GET: View all bookings (protected)
app.get('/bookings', async (req, res) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const allBookings = await bookings.find().toArray();
    res.json(allBookings);
  } catch (err) {
    console.error('❌ Failed to load bookings:', err);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// ✅ GET: Ping route to wake up Render
app.get('/ping', (req, res) => {
  res.status(200).send('pong');
});

// ✅ Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

async function sendBookingNotification(data) {
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT),
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const formatted = Object.entries(data)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');

  await transporter.sendMail({
    from: `"Maria Studio Booking" <${process.env.EMAIL_USER}>`,
    to: process.env.EMAIL_TO,
    subject: '📸 New Booking Received',
    text: `A new booking was submitted:\n\n${formatted}`
  });
}
