// server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import multer from 'multer';
import { MongoClient, ServerApiVersion } from 'mongodb';

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 3000;

// CORS + JSON (JSON limit is small now since we use multipart for files)
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Multer (memory) for single optional file upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10 MB; adjust as needed
  }
});

// Mongo
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

let db, bookings;

client.connect()
  .then(() => {
    db = client.db('mariastudio');
    bookings = db.collection('bookings');
    console.log('✅ Connected to MongoDB Atlas');
  })
  .catch((err) => {
    console.error('❌ MongoDB connection failed:', err);
  });

// Health
app.get('/ping', (_req, res) => res.status(200).send('pong'));

/**
 * POST /submit-booking
 * Accepts multipart/form-data with optional file field "general_eqlistfile".
 * Text fields are in req.body; file (if any) is in req.file.
 */
app.post('/submit-booking', upload.single('general_eqlistfile'), async (req, res) => {
  try {
    const file = req.file || null;

    // Store only lightweight file metadata in DB (avoid giant base64 in DB)
    const fileMeta = file ? {
      originalname: file.originalname,
      mimetype:     file.mimetype,
      size:         file.size
    } : null;

    const bookingData = {
      ...req.body,
      date: new Date().toISOString(),
      ...(fileMeta ? { file: fileMeta } : {})
    };

    const result = await bookings.insertOne(bookingData);

    await sendBookingNotification(bookingData, file);

    res.json({ message: 'Booking saved', id: result.insertedId });
  } catch (err) {
    console.error('❌ Failed to insert booking or send email:', err);
    res.status(500).json({ error: 'Failed to save booking' });
  }
});

/**
 * GET /bookings
 * Bearer-protected simple listing
 */
app.get('/bookings', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const all = await bookings.find().toArray();
    res.json(all);
  } catch (err) {
    console.error('❌ Failed to load bookings:', err);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

/* ---------------------------
   Email helper (with optional attachment)
--------------------------- */
async function sendBookingNotification(data, file) {
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT || '587', 10),
    secure: String(process.env.EMAIL_SECURE || 'false') === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  // Flatten key/value text body
  const formatted = Object.entries(data)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  const mailOptions = {
    from: `"Maria Studio Booking" <${process.env.EMAIL_USER}>`,
    to: process.env.EMAIL_TO,
    subject: '📸 New Booking Received',
    text: `A new booking was submitted:\n\n${formatted}`,
    attachments: []
  };

  // Attach uploaded file if present
  if (file) {
    mailOptions.attachments.push({
      filename: file.originalname,
      content: file.buffer,
      contentType: file.mimetype
    });
  }

  await transporter.sendMail(mailOptions);
}
