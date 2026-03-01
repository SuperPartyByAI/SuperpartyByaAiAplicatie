const fs = require('fs');
const path = require('path');

function walk(dir, done) {
  let results = [];
  fs.readdir(dir, function (err, list) {
    if (err) return done(err);
    let pending = list.length;
    if (!pending) return done(null, results);
    list.forEach(function (file) {
      file = path.resolve(dir, file);
      fs.stat(file, function (err, stat) {
        if (stat && stat.isDirectory()) {
          walk(file, function (err, res) {
            results = results.concat(res);
            if (!--pending) done(null, results);
          });
        } else {
          results.push(file);
          if (!--pending) done(null, results);
        }
      });
    });
  });
}

const dir = path.join(__dirname, 'server');
walk(dir, function(err, results) {
  if (err) throw err;
  results.forEach(file => {
    try {
      let content = fs.readFileSync(file, 'utf8');
      let changed = false;
      const twilioRegex = /(AC|SK)[0-9a-fA-F]{32}/g;
      const gcpRegex = /"private_key"\s*:\s*"[^"]*"/g;
      
      if (twilioRegex.test(content)) {
        content = content.replace(twilioRegex, '[REDACTED_TWILIO]');
        changed = true;
      }
      if (gcpRegex.test(content)) {
        content = content.replace(gcpRegex, '"private_key":"[REDACTED_GCP]"');
        changed = true;
      }
      if (changed) {
        fs.writeFileSync(file, content, 'utf8');
        console.log('Cleaned file:', file);
      }
    } catch(e) {
      // ignore
    }
  });
});
