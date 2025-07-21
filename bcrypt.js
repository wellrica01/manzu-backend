const bcrypt = require('bcrypt');
const password = process.argv[2];

bcrypt.hash(password, 10, function(err, hash) {
    if (err) throw err;
    console.log('Hashed password:', hash);
});
