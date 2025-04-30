import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
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
    res.json({ message: 'Booking saved', id: result.insertedId });
  } catch (err) {
    console.error('❌ Failed to insert booking:', err);
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


// ✅ Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
