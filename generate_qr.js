const QRCode = require('qrcode');
QRCode.toFile('C:\\Users\\Hp\\.gemini\\antigravity-ide\\brain\\cc8d4adf-430d-4843-9e70-1c114c3e8a9b\\expo_qr.png', 'exp://192.168.1.2:8081', {
  color: {
    dark: '#000000',
    light: '#ffffff'
  }
}, function (err) {
  if (err) throw err;
  console.log('done');
});
