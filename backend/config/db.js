// ------------------------------------------------------------
// config/db.js  -  connects our app to the MongoDB database
// ------------------------------------------------------------
import dns from 'node:dns';
import { isIP } from 'node:net';
import mongoose from 'mongoose';

export async function connectDb() {
  const url = process.env.MONGODB_URL;
  if (!url) throw new Error('MONGODB_URL is not set in backend/.env');

  // Optional: some networks cannot resolve MongoDB Atlas addresses.
  // If MONGODB_DNS_SERVERS is set (example: 8.8.8.8,1.1.1.1) we use those DNS servers.
  if (process.env.MONGODB_DNS_SERVERS) {
    const servers = process.env.MONGODB_DNS_SERVERS.split(',').map((s) => s.trim());
    if (servers.some((s) => !isIP(s))) {
      throw new Error('MONGODB_DNS_SERVERS must be a comma-separated list of DNS server IP addresses.');
    }
    dns.setServers(servers);
  }

  await mongoose.connect(url);
  console.log('MongoDB connected');
}
