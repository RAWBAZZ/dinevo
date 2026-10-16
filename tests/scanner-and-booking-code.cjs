const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'booking-centre.js'), 'utf8');
const customer = fs.readFileSync(path.join(root, 'booking-centre.html'), 'utf8');
const partner = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261016223000_five_digit_booking_codes.sql'), 'utf8');

assert.match(customer, /jsqr@1\\.4\\.0\\/dist\\/jsQR\\.js/);
assert.match(partner, /jsqr@1\\.4\\.0\\/dist\\/jsQR\\.js/);
assert.match(app, /window\\.jsQR\\(ctx\\.getImageData/);
assert.match(app, /window\\.BarcodeDetector/);
assert.match(app, /navigator\\.mediaDevices\\?\\.getUserMedia/);
assert.match(app, /\\^\\\\d\\{5\\}\\$/);
assert.match(app, /booking_code/);
assert.match(migration, /unique index if not exists d2_bookings_booking_code_key/);
assert.match(migration, /check \\(booking_code between 10000 and 99999\\)/);
console.log('Scanner fallback and five-digit booking-code checks passed.');
