#!/usr/bin/env node

var fs = require('fs');
var readline = require('readline');
var google = require('googleapis');
var googleAuth = require('google-auth-library');
var ExifImage = require('exif').ExifImage;
var path = require('path');

// If modifying these scopes, delete your previously saved credentials
// at ~/.credentials/drive-nodejs-quickstart.json
var SCOPES = ['https://www.googleapis.com/auth/drive.metadata.readonly'];
var TOKEN_DIR = (process.env.HOME || process.env.HOMEPATH ||
    process.env.USERPROFILE) + '/.credentials/';
var TOKEN_PATH = TOKEN_DIR + 'drive-nodejs-quickstart.json';

function download () {
  // Load client secrets from a local file.
  fs.readFile('client_secret.json', function processClientSecrets(err, content) {
    if (err) {
      console.log('Error loading client secret file: ' + err);
      return;
    }
    // Authorize a client with the loaded credentials, then call the
    // Drive API.
    authorize(JSON.parse(content), listFiles);
  });
}

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 *
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
  var clientSecret = credentials.installed.client_secret;
  var clientId = credentials.installed.client_id;
  var redirectUrl = credentials.installed.redirect_uris[0];
  var auth = new googleAuth();
  var oauth2Client = new auth.OAuth2(clientId, clientSecret, redirectUrl);

  // Check if we have previously stored a token.
  fs.readFile(TOKEN_PATH, function(err, token) {
    if (err) {
      getNewToken(oauth2Client, callback);
    } else {
      oauth2Client.credentials = JSON.parse(token);
      callback(oauth2Client);
    }
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 *
 * @param {google.auth.OAuth2} oauth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback to call with the authorized
 *     client.
 */
function getNewToken(oauth2Client, callback) {
  var authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES
  });
  console.log('Authorize this app by visiting this url: ', authUrl);
  var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  rl.question('Enter the code from that page here: ', function(code) {
    rl.close();
    oauth2Client.getToken(code, function(err, token) {
      if (err) {
        console.log('Error while trying to retrieve access token', err);
        return;
      }
      oauth2Client.credentials = token;
      storeToken(token);
      callback(oauth2Client);
    });
  });
}

/**
 * Store token to disk be used in later program executions.
 *
 * @param {Object} token The token to store to disk.
 */
function storeToken(token) {
  try {
    fs.mkdirSync(TOKEN_DIR);
  } catch (err) {
    if (err.code != 'EEXIST') {
      throw err;
    }
  }
  fs.writeFile(TOKEN_PATH, JSON.stringify(token));
  console.log('Token stored to ' + TOKEN_PATH);
}

/**
 * Lists the names and IDs of up to 10 files.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
function listFiles(auth, pageToken) {
  if (!pageToken) {
    // first call
    console.log('[');
  }

  var service = google.drive('v3');
  service.files.list({
    auth: auth,
    pageSize: 1000,
    pageToken: pageToken,
    fields: "nextPageToken, files(md5Checksum, name, size, imageMediaMetadata)"
  }, function(err, response) {
    if (err) {
      console.log('The API returned an error: ' + err);
      process.exit(2);
      return;
    }
    var files = response.files;
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      var meta = file.imageMediaMetadata;
      if (meta) {
        console.log(JSON.stringify({
          name: file.name,
          time: meta.time,
          exposureTime: meta.exposureTime,
          isoSpeed: meta.isoSpeed,
          aperture: meta.aperture,
          focalLength: meta.focalLength
        }));
        console.log(',');
      }
    }
    if (response.nextPageToken) {
      listFiles(auth, response.nextPageToken);
    } else {
      console.log('{}]');
    }
  });
}

function normalize (o) {
  return {
    time: o.time,
    exposureTime: Math.round(o.exposureTime * 1),
    aperture: Math.round(o.aperture * 1),
    isoSpeed: Math.round(o.isoSpeed / 1),
    focalLength: Math.round(o.focalLength),
    name: o.name,
  };
}

function loadImage (file, callback) {
  new ExifImage({ image : file }, function (error, result) {
    if (error) {
      console.error('Error: '+error.message);
      process.exit(1);
    } else {
      let d = result.exif;
      callback(normalize({
        time: d.DateTimeOriginal,
        exposureTime: d.ExposureTime,
        aperture: d.ApertureValue,
        isoSpeed: d.ISO,
        focalLength: Math.round(d.FocalLength),
        name: path.basename(file),
      }));
    }
  });
}

function check (dbFile, files) {
  let db = JSON.parse(fs.readFileSync(dbFile).toString());

  function loop(files) {
    if (files.length === 0) {
      process.exit(0);
    }
    let file = files.shift();

    function checkImage (file, callback) {
      loadImage(file, function (data) {
        let candidates = [];
        for (let i = 0; i < db.length; i++) {
          let entry = normalize(db[i]);
          if (entry.time === data.time) {
            candidates.push(entry);
          }
        }

        if (candidates.length === 0) {
          return callback('no matching times');
        }

        let nameMatches = candidates.filter(x => x.name === data.name);
        if (nameMatches.length === 0) {
          return callback('no matching names');
        }

        if (nameMatches.length === 1) {
          return callback(null, 'ok');
        } else {
          return callback('too many matches');
        }
      });
    }

    checkImage(file, function(err, result) {
      if (err) {
        console.log(file + ': ' + err);
      } else {
        console.log(file + ': ' + result);
      }
      loop(files);
    });
  }
  loop(files);
}


let argv = process.argv.slice(1);
switch (argv[1]) {
  case '--download':
    download();
    break;

  case '--check':
    check(argv[2], argv.slice(3));
    break;

  default:
    console.log(argv);
    console.log('unknown option');
}
