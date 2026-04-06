const mongoose = require('mongoose');
require('dotenv').config();

const userSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  name: String,
  role: String
});
const User = mongoose.model('User', userSchema);

async function listUsers() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const users = await User.find();
    console.log('--- USER REGISTRY ---');
    users.forEach(u => console.log(`[${u.role || 'user'}] ${u.email} - ${u.name}`));
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

listUsers();
