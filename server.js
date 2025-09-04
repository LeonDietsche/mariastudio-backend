// server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import multer from 'multer';
import { MongoClient, ServerApiVersion } from 'mongodb';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
// keep JSON for other routes; set a modest limit
app.use(express.json({ limit: '1mb' }));

// ── Multer: accept one optional PDF (field name must be "general_eqlistfile")
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    // allow only PDFs; relax if you want to accept more types
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed.'));
  }
});

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
});

let db, bookings;

// connect once on boot
client.connect()
  .then(() => {
    db = client.db('mariastudio');
    bookings = db.collection('bookings');
    console.log('✅ Connected to MongoDB Atlas');
  })
  .catch(err => console.error('❌ MongoDB connection failed:', err));

// ── POST: save booking (fields + optional file)
app.post('/submit-booking', upload.single('general_eqlistfile'), async (req, res) => {
  try {
    // All text inputs (including textarea) arrive as strings on req.body
    const fields = req.body;

    // Store only metadata about the file (not the binary) in Mongo
    const fileMeta = req.file
      ? {
          originalname: req.file.originalname,
          mimetype: req.file.mimetype,
          size: req.file.size
        }
      : null;

    const record = {
      ...fields,
      uploaded_file: fileMeta,
      date: new Date().toISOString()
    };

    const result = await bookings.insertOne(record);

    // Email notification (with the PDF attached if present)
    await sendBookingNotification(record, req.file);

    res.json({ message: 'Booking saved', id: result.insertedId });
  } catch (err) {
    console.error('❌ Failed to insert booking or send email:', err);
    res.status(500).json({ error: 'Failed to save booking' });
  }
});

// ── GET: all bookings (protected)
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

// ── Ping route
app.get('/ping', (req, res) => res.status(200).send('pong'));

// ── Multer error handler (nice 400s instead of 500s)
app.use((err, req, res, next) => {
  if (err && err.name === 'MulterError') {
    return res.status(400).json({ error: err.message });
  }
  if (err && err.message === 'Only PDF files are allowed.') {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

// ── Start
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

// ── Email helper (attaches file if present)
async function sendBookingNotification(data, file) {
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT, 10),
    secure: false,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
  });

  const formatted = Object.entries(data)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  await transporter.sendMail({
    from: `"Maria Studio Booking" <${process.env.EMAIL_USER}>`,
    to: process.env.EMAIL_TO,
    subject: '📸 New Booking Received',
    text: `A new booking was submitted:\n\n${formatted}`,
    attachments: file
      ? [{ filename: file.originalname, content: file.buffer, contentType: file.mimetype }]
      : []
  });
}
