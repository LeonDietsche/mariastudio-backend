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

// CORS + JSON (keep JSON small; files come via multipart)
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Multer (memory) for single optional file upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

// Mongo
const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true }
});

let db, bookings;

client.connect()
  .then(() => {
    db = client.db('mariastudio');
    bookings = db.collection('bookings');
    console.log('✅ Connected to MongoDB Atlas');
  })
  .catch((err) => console.error('❌ MongoDB connection failed:', err));

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

    // Store only lightweight file metadata in DB
    const fileMeta = file ? {
      originalname: file.originalname,
      mimetype:     file.mimetype,
      size:         file.size
    } : null;

    const bookingData = {
      ...req.body,                    // NOTE: multipart text fields are strings
      date: new Date().toISOString(),
      ...(fileMeta ? { file: fileMeta } : {})
    };

    const result = await bookings.insertOne(bookingData);

    // Email admin + client, attach file for admin only
    await sendBookingNotification(bookingData, file);

    res.json({ message: 'Booking saved', id: result.insertedId });
  } catch (err) {
    console.error('❌ Failed to insert booking or send email:', err);
    res.status(500).json({ error: 'Failed to save booking' });
  }
});

/**
 * GET /bookings  (Bearer-protected)
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
   Email helper (formatted + optional attachment)
--------------------------- */

async function sendBookingNotification(data, file) {
  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT || '587', 10),
    secure: String(process.env.EMAIL_SECURE || 'false') === 'true',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
  });

  const from        = `"Maria Studio Booking" <${process.env.EMAIL_USER}>`;
  const adminTo     = process.env.EMAIL_TO;
  const clientEmail = (data.contact_email || '').trim();

  // Build pretty HTML + text versions
  const htmlAdmin  = buildHtmlEmail(data, { audience: 'admin' });
  const textAdmin  = buildTextEmail(data);
  const htmlClient = buildHtmlEmail(data, { audience: 'client' });
  const textClient = buildTextEmail(data);

  // 1) Admin email (attach uploaded file if present)
  await transporter.sendMail({
    from,
    to: adminTo,
    replyTo: clientEmail || from,
    subject: '📸 New Booking Received',
    html: htmlAdmin,
    text: textAdmin,
    attachments: file ? [{
      filename: file.originalname,
      content: file.buffer,
      contentType: file.mimetype
    }] : []
  });

  // 2) Confirmation to client (no attachment)
  if (clientEmail) {
    await transporter.sendMail({
      from,
      to: clientEmail,
      subject: 'We received your booking – Maria Studio',
      html: htmlClient,
      text: textClient,
    });
  }
}

/* ---------- formatting helpers ---------- */

const LABELS = {
  // contact
  'contact_name': 'Name',
  'contact_email': 'Email',
  'contact_phone': 'Phone',
  'contact_company': 'Company',
  'contact_shootdays': 'Shoot Days',
  'contact_appointment-dates': 'Appointment Dates',
  'contact_firsttime': 'First Time?',
  // role
  'youarea': 'You are',
  // project
  'general_project-type': 'Project Type',
  'general_photographer': 'Photographer',
  'general_brandname': 'Brand Name',
  'general_magazinename': 'Magazine Name',
  'general_tellusmore': 'Tell us more',
  'general_numberofpeople': 'Number of People',
  // equipment
  'general_equipmentlistready': 'EQ List Ready?',
  'general_eqlisttext': 'Equipment List (pasted)',
  // billing
  'billing_details': 'Billing Details',
  'billing_company': 'Company',
  'billing_street': 'Street',
  'billing_city': 'City',
  'billing_state': 'State / Region',
  'billing_postalcode': 'Postal Code',
  'billing_country': 'Country',
  'billing_Country': 'Country',
  'billing_vatnumber': 'VAT Number',
  // meta
  'client_date': 'Client Time',
  'date': 'Server Time',
};

const EXCLUDE_KEYS = new Set(['_id', 'file', 'file_name', 'file_content']);

function titleCase(s) {
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
function prettyLabel(key) { return LABELS[key] || titleCase(key); }
function escapeHtml(s = '') {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function groupKeys(data) {
  const keys = Object.keys(data);
  const groups = { Contact: [], Project: [], Equipment: [], Billing: [], Meta: [] };

  for (const k of keys) {
    if (EXCLUDE_KEYS.has(k)) continue;
    const v = data[k];
    if (v == null || String(v).trim() === '') continue;

    if (k.startsWith('contact_') || k === 'youarea') groups.Contact.push(k);
    else if (k.startsWith('general_equipment')) groups.Equipment.push(k);
    else if (k.startsWith('general_')) groups.Project.push(k);
    else if (k.startsWith('billing_') || k === 'billing_Country') groups.Billing.push(k);
    else if (k === 'client_date' || k === 'date') groups.Meta.push(k);
    else groups.Project.push(k);
  }

  const order = (arr, wanted) => {
    const set = new Set(arr);
    return [...wanted.filter(k => set.has(k)), ...arr.filter(k => !wanted.includes(k))];
  };

  groups.Contact = order(groups.Contact, [
    'contact_name','contact_email','contact_phone','contact_company',
    'contact_firsttime','youarea','contact_shootdays','contact_appointment-dates'
  ]);
  groups.Project = order(groups.Project, [
    'general_project-type','general_brandname','general_magazinename',
    'general_photographer','general_numberofpeople','general_tellusmore'
  ]);
  groups.Equipment = order(groups.Equipment, [
    'general_equipmentlistready','general_eqlisttext'
  ]);
  groups.Billing = order(groups.Billing, [
    'billing_details','billing_company','billing_street','billing_city',
    'billing_state','billing_postalcode','billing_country','billing_Country','billing_vatnumber'
  ]);

  return groups;
}

function rowsForKeys(data, keys) {
  return keys.map(k => {
    const raw = data[k];
    const val = Array.isArray(raw) ? raw.join(', ') : String(raw);
    return `
      <tr>
        <td width="32%" style="vertical-align:top;border-bottom:1px solid #eee;background:#fafafa">
          <strong>${escapeHtml(prettyLabel(k))}</strong>
        </td>
        <td style="vertical-align:top;border-bottom:1px solid #eee">
          ${escapeHtml(val)}
        </td>
      </tr>`;
  }).join('');
}

function sectionTableHtml(title, rowsHtml) {
  if (!rowsHtml) return '';
  return `
    <h3 style="margin:16px 0 6px 0;font-family:Arial,Helvetica,sans-serif;
               font-weight:600;font-size:14px">${escapeHtml(title)}</h3>
    <table width="100%" cellpadding="6" cellspacing="0"
           style="border-collapse:collapse;border:1px solid #eee;
                  font-family:Arial,Helvetica,sans-serif;font-size:13px">
      ${rowsHtml}
    </table>`;
}

function buildHtmlEmail(data, { audience } = {}) {
  const groups = groupKeys(data);

  const intro =
    audience === 'client'
      ? `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px">
           Hi ${escapeHtml(data.contact_name || '')},<br>
           thanks for your booking request. Here’s what we received:
         </p>`
      : `<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px">
           A new booking was submitted:
         </p>`;

  const contact   = sectionTableHtml('Contact',   rowsForKeys(data, groups.Contact));
  const project   = sectionTableHtml('Project',   rowsForKeys(data, groups.Project));
  const equipment = sectionTableHtml('Equipment', rowsForKeys(data, groups.Equipment));
  const billing   = sectionTableHtml('Billing',   rowsForKeys(data, groups.Billing));
  const meta      = sectionTableHtml('Meta',      rowsForKeys(data, groups.Meta));

  const outro =
    audience === 'client'
      ? `<p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;margin-top:16px">
           We’ll get back to you shortly.<br>
           — Maria Studio
         </p>`
      : '';

  return `
    <div style="max-width:680px;margin:0 auto;padding:12px">
      ${intro}
      ${contact}${project}${equipment}${billing}${meta}
      ${outro}
    </div>`;
}

function buildTextEmail(data) {
  const groups = groupKeys(data);
  const render = keys => keys.map(k => `${prettyLabel(k)}: ${Array.isArray(data[k]) ? data[k].join(', ') : data[k]}`).join('\n');

  let out = [];
  if (groups.Contact.length)   out.push('CONTACT\n'    + render(groups.Contact));
  if (groups.Project.length)   out.push('\nPROJECT\n'  + render(groups.Project));
  if (groups.Equipment.length) out.push('\nEQUIPMENT\n'+ render(groups.Equipment));
  if (groups.Billing.length)   out.push('\nBILLING\n'  + render(groups.Billing));
  if (groups.Meta.length)      out.push('\nMETA\n'     + render(groups.Meta));
  return out.join('\n');
}
