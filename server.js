const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Serve static uploads hub
const uploadsDir = path.join(__dirname, 'uploads');
const carImagesDir = path.join(uploadsDir, 'carImages');
[uploadsDir, carImagesDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.use('/uploads', express.static(uploadsDir));

// DriveFlex Database Node Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ RG SELF DRIVE: Primary Registry Hub Synchronized.'))
  .catch((err) => console.error('❌ HUB ERROR: MongoDB Connection Failure.', err));

// --- DriveFlex Mongoose Models ---

const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true, required: true },
  phone: String,
  password: { type: String, required: true },
  role: { type: String, default: 'user' }
});

const locationSchema = new mongoose.Schema({
  name: { type: String, unique: true, required: true }
});

const categorySchema = new mongoose.Schema({
  name: { type: String, unique: true, required: true }
});

const carSchema = new mongoose.Schema({
  id: String,
  name: String,
  category: String,
  price: Number,
  image: String,
  locations: [String],
  specs: {
    transmission: String,
    fuel: String,
    seats: Number
  },
  status: { type: String, default: 'Available' },
  dailyKmLimit: { type: Number, default: 300 },
  extraKmCharge: { type: Number, default: 12 }
});

// Global pricing settings (singleton document)
const settingsSchema = new mongoose.Schema({
  defaultDailyKmLimit: { type: Number, default: 300 },
  defaultExtraKmCharge: { type: Number, default: 12 },
  lateReturnChargePerHour: { type: Number, default: 150 },
  upiId: { type: String, default: '' },
  qrCode: { type: String, default: '' }
}, { timestamps: true });

const Settings = mongoose.model('Settings', settingsSchema);

const bookingSchema = new mongoose.Schema({
  id: String,
  car: { type: mongoose.Schema.Types.Mixed },
  location: String,
  pickupDate: String,
  pickupTime: String,
  dropDate: String,
  dropTime: String,
  durationDays: Number,
  userData: {
    name: String,
    phone: String,
    email: String
  },
  docs: {
    license: String,
    identityProof: String
  },
  payment: {
    method: String, 
    provider: String,
    status: { type: String, default: 'Paid' }
  },
  tripDetails: {
    start: {
      km: Number,
      vehicleNo: String,
      petrolLevel: String,
      photos: [String],
      timestamp: Date
    },
    end: {
      km: Number,
      totalKm: Number,
      overKm: Number,
      overKmCharge: Number,
      lateHours: Number,
      lateCharge: Number,
      extraCharge: Number,
      petrolLevel: String,
      photos: [String],
      damageNote: String,
      timestamp: Date,
      isSettled: { type: Boolean, default: false }
    }
  },
  rentalAmount: Number,
  depositAmount: Number,
  totalAmount: Number,
  date: { type: Date, default: Date.now },
  status: { 
    type: String, 
    enum: ['Confirmed', 'Pending', 'Driving', 'Completed', 'Canceled'],
    default: 'Confirmed' 
  },
  isDepositRefunded: { type: Boolean, default: false }
});

const User = mongoose.model('User', userSchema);
const Location = mongoose.model('Location', locationSchema);
const Category = mongoose.model('Category', categorySchema);
const Car = mongoose.model('Car', carSchema);
const Booking = mongoose.model('Booking', bookingSchema);

// --- RG Self Drive Multer Hub (Document & Fleet Asset Registry) ---

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'carImage') {
      cb(null, 'uploads/carImages/');
    } else {
      cb(null, 'uploads/');
    }
  },
  filename: (req, file, cb) => {
    if (file.fieldname === 'carImage') {
      // Use carName query param or a safe fallback
      const carName = (req.query.carName || 'Asset').replace(/\s+/g, '-');
      cb(null, `${carName}-1${path.extname(file.originalname)}`);
    } else {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
  }
});
const upload = multer({ storage });

app.post('/api/upload', upload.fields([
  { name: 'license', maxCount: 1 },
  { name: 'identityProof', maxCount: 1 },
  { name: 'carImage', maxCount: 1 },
  { name: 'tripPhotos', maxCount: 10 },
  { name: 'qrCode', maxCount: 1 }
]), (req, res) => {
  try {
    const paths = {};
    if (req.files['license']) paths.license = `/uploads/${req.files['license'][0].filename}`;
    if (req.files['identityProof']) paths.identityProof = `/uploads/${req.files['identityProof'][0].filename}`;
    if (req.files['carImage']) paths.carImage = `/uploads/carImages/${req.files['carImage'][0].filename}`;
    if (req.files['qrCode']) paths.qrCode = `/uploads/${req.files['qrCode'][0].filename}`;
    if (req.files['tripPhotos']) {
      paths.tripPhotos = req.files['tripPhotos'].map(f => `/uploads/${f.filename}`);
    }
    res.json(paths);
  } catch (err) {
    console.error('Upload Error:', err);
    res.status(500).json({ message: 'Upload Hub Error: Registry Failure.' });
  }
});

// --- DriveFlex Identity & Access Hub ---

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || user.password !== password) {
      return res.status(401).json({ message: 'Identity Verification Failure: Invalid Credentials.' });
    }
    res.json({ name: user.name, email: user.email, phone: user.phone, role: user.role });
  } catch (err) {
    res.status(500).json({ message: 'Identity Hub Error: System Failure.' });
  }
});

app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: 'User already exists with this email.' });
    const newUser = new User({ name, email, password, phone, role: 'user' });
    await newUser.save();
    res.status(201).json({ user: { name, email, phone, role: 'user' } });
  } catch (err) {
    res.status(500).json({ message: 'Registration failed. Please try again.' });
  }
});

// Reset Password Registry
app.post('/api/reset-password', async (req, res) => {
  try {
    const { identifier, newPassword } = req.body; // identifier can be email or phone
    const user = await User.findOne({ $or: [{ email: identifier }, { phone: identifier }] });
    
    if (!user) {
      return res.status(404).json({ message: 'Account not found with this email/phone.' });
    }

    user.password = newPassword;
    await user.save();
    res.json({ message: 'Password updated successfully.' });
  } catch (err) {
    res.status(500).json({ message: 'Reset failed. Please try again later.' });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find({ role: 'user' }).select('-password');
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: 'Hub Error: User Registry Read Failure.' });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'Identity decommissioned.' });
  } catch (err) {
    res.status(500).json({ message: 'Hub Error: Decommission Failure.' });
  }
});

// --- DriveFlex API Registry ---

// Locations Registry
app.get('/api/locations', async (req, res) => {
  try { 
    const locs = await Location.find();
    res.json(locs); 
  } catch (err) { 
    console.error('Location Fetch Error:', err);
    res.status(500).json({ message: 'Hub Error' }); 
  }
});

app.post('/api/locations', async (req, res) => {
  try {
    const loc = new Location(req.body);
    await loc.save();
    res.status(201).json(loc);
  } catch (err) { 
    console.error('Location Post Error:', err);
    res.status(400).json({ message: 'Hub Error' }); 
  }
});

app.delete('/api/locations/:id', async (req, res) => {
  try {
    await Location.findByIdAndDelete(req.params.id);
    res.json({ message: 'Location decommissioned.' });
  } catch (err) { res.status(500).json({ message: 'Hub Error' }); }
});

// Categories Registry
app.get('/api/categories', async (req, res) => {
  try { 
    const cats = await Category.find();
    res.json(cats); 
  } catch (err) { 
    res.status(500).json({ message: 'Hub Error' }); 
  }
});

app.post('/api/categories', async (req, res) => {
  try {
    const cat = new Category(req.body);
    await cat.save();
    res.status(201).json(cat);
  } catch (err) { 
    res.status(400).json({ message: 'Hub Error: Possible Duplicate or Validation Failure.' }); 
  }
});

app.delete('/api/categories/:id', async (req, res) => {
  try {
    await Category.findByIdAndDelete(req.params.id);
    res.json({ message: 'Category removed.' });
  } catch (err) { res.status(500).json({ message: 'Hub Error' }); }
});

app.get('/api/cars', async (req, res) => {
  try { res.json(await Car.find()); } catch (err) { res.status(500).json({ message: 'Hub Error' }); }
});

app.post('/api/cars', async (req, res) => {
  try {
    const newUnit = new Car(req.body);
    await newUnit.save();
    res.status(201).json(newUnit);
  } catch (err) { res.status(400).json({ message: 'Hub Error' }); }
});

app.put('/api/cars/:id', async (req, res) => {
  try {
    const updated = await Car.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(updated);
  } catch (err) { res.status(400).json({ message: 'Hub Error' }); }
});

app.delete('/api/cars/:id', async (req, res) => {
  try {
    await Car.findByIdAndDelete(req.params.id);
    res.json({ message: 'Unit decommissioned.' });
  } catch (err) { res.status(500).json({ message: 'Hub Error' }); }
});

app.post('/api/bookings', async (req, res) => {
  try {
    const newBooking = new Booking(req.body);
    await newBooking.save();
    res.status(201).json(newBooking);
  } catch (err) { res.status(400).json({ message: 'Hub Error' }); }
});

app.get('/api/bookings', async (req, res) => {
  try {
    const { email } = req.query;
    const query = email ? { 'userData.email': email } : {};
    res.json(await Booking.find(query).sort({ date: -1 }));
  } catch (err) { res.status(500).json({ message: 'Hub Error' }); }
});

app.patch('/api/bookings/:id', async (req, res) => {
  try {
    res.json(await Booking.findByIdAndUpdate(req.params.id, req.body, { new: true }));
  } catch (err) { res.status(400).json({ message: 'Hub Error' }); }
});

app.delete('/api/bookings/:id', async (req, res) => {
  try {
    await Booking.findByIdAndDelete(req.params.id);
    res.json({ message: 'Reservation purged.' });
  } catch (err) { res.status(500).json({ message: 'Hub Error' }); }
});

// --- Global Pricing Settings ---
app.get('/api/settings', async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await new Settings({}).save();
    }
    res.json(settings);
  } catch (err) { res.status(500).json({ message: 'Settings fetch error.' }); }
});

app.put('/api/settings', async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = new Settings(req.body);
    } else {
      Object.assign(settings, req.body);
    }
    await settings.save();
    res.json(settings);
  } catch (err) { res.status(500).json({ message: 'Settings update error.' }); }
});

app.get('/api/analytics', async (req, res) => {
  try {
    const allBookings = await Booking.find();
    const allCars = await Car.find();
    const revenue = allBookings.reduce((sum, b) => sum + (b.totalAmount || 0), 0);
    res.json({
      totalRevenue: revenue,
      activeReservations: allBookings.filter(b => b.status === 'Confirmed').length,
      fleetCount: allCars.length,
      confirmedOrders: allBookings.filter(b => b.status === 'Confirmed').length,
      completedSequences: allBookings.filter(b => b.status === 'Completed').length,
    });
  } catch (err) { res.status(500).json({ message: 'Hub Error' }); }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`📡 DRIVEFLEX HUB operational on http://localhost:${PORT}`));
