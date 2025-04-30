 
import express from 'express';
import cors from 'cors';
import fs from 'fs';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const filePath = './bookings.json';

app.post('/submit-booking', (req, res) => {
  const bookingData = req.body;

  let current = [];
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    current = JSON.parse(data || '[]');
  } catch (err) {
    console.error('Error reading bookings.json:', err);
  }

  current.push({ ...bookingData, date: new Date().toISOString() });
  fs.writeFileSync(filePath, JSON.stringify(current, null, 2));

  res.json({ message: 'Booking received' });
});

app.get('/bookings', (req, res) => {
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(500).json({ error: 'Failed to read bookings.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});