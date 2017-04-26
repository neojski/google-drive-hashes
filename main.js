#!/usr/bin/env node

var program = require('commander');
var fs = require('fs');
var readline = require('readline');
var google = require('googleapis');
var googleAuth = require('google-auth-library');
var path = require('path');

var exiftool = require('node-exiftool')
var exiftoolBin = require('dist-exiftool')
var ep = new exiftool.ExiftoolProcess(exiftoolBin)

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
    fields: "nextPageToken, files(name, imageMediaMetadata, videoMediaMetadata)"
  }, function(err, response) {
    if (err) {
      console.log('The API returned an error: ' + err);
      process.exit(2);
      return;
    }
    var files = response.files;
    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      if (file.imageMediaMetadata) {
        let meta = file.imageMediaMetadata;
        console.log(JSON.stringify({
          name: file.name,
          time: meta.time,
          exposureTime: meta.exposureTime,
          isoSpeed: meta.isoSpeed,
          aperture: meta.aperture,
          focalLength: meta.focalLength
        }));
      } else if (file.videoMediaMetadata) {
        let meta = file.videoMediaMetadata;
        console.log(JSON.stringify({
          name: file.name,
          durationMillis: meta.durationMillis
        }));
      } else {
        console.log(JSON.stringify({
          name: file.name,
        }));
      }
      console.log(',');
    }
    if (response.nextPageToken) {
      listFiles(auth, response.nextPageToken);
    } else {
      console.log('{}]');
    }
  });
}

function normalize (o) {
  if (o.durationMillis) {
    return {
      name: o.name,
      durationMillis: o.durationMillis,
      precision: o.precision,
    };
  } else {
    return {
      time: o.time,
      exposureTime: Math.round(o.exposureTime * 1),
      aperture: Math.round(o.aperture * 1),
      isoSpeed: Math.round(o.isoSpeed / 1),
      focalLength: Math.round(o.focalLength),
      name: o.name,
    };
  }
}

function fin (promise, cb) {
  let res = () => promise;
  let f = () => Promise.resolve(cb()).then(res);
  return promise.then(f, f);
}

function isAscii (str) {
  return /^[ -~]+$/.test(str);
}

function readMetadata(file) {
  // TODO: This whole dance is because of Sobesednik/node-exiftool/issues/20
  let ascii = file;
  if (!isAscii (file)) {
    let dir = fs.mkdtempSync('read-metadata-');
    ascii = path.join(dir, 'temp');
    console.error('renaming ' + file + ' to ' + ascii);
    fs.renameSync(file, ascii);
  }
  return fin(ep.readMetadata(ascii), () => {
    // rename back
    if (ascii !== file) {
      console.error('unreming ' + file + ' to ' + ascii);
      fs.renameSync(ascii, file);
    }
  }).then((result) => {
    if (result.error) {
      throw result.error;
    }
    if (result.data.length !== 1) {
      throw 'Incorrect number of data in result (readMetadata)';
    }
    return result.data[0];
  });
}

function loadImage (file) {
  return readMetadata(file).then((result) => {
    let name = path.basename(file);
    let data;
    // TODO: I have no idea what's the difference between Duration and TrackDuration and why Google uses the latter
    if (result.TrackDuration) {
      let d = result.TrackDuration;
      let durationMillis;
      let precision;
      if (d.indexOf('s') > -1) {
        durationMillis = 1000 * parseFloat(d);
        precision = 3;
      } else if (d.indexOf(':')) {
        let matches = d.match(/(\d+):(\d+):(\d+)/);
        durationMillis = 1000 * ((+matches[1]) * 3600 + (+matches[2]) * 60 + (+matches[3]));
        precision = 1;
      }
      return {
        durationMillis: durationMillis,
        precision: precision,
        name: name,
      };
    }

    return {
      // Google uses ModifyDate even though the documentation suggests Create Date
      time: result.ModifyDate,
      exposureTime: result.ExposureTime,
      aperture: result.ApertureValue,
      isoSpeed: result.ISO,
      focalLength: Math.round(result.FocalLength),
      name: name,
    };
  });
}

function check (dbFile, verbose) {
  let db = JSON.parse(fs.readFileSync(dbFile).toString());

  function multiAdd(m, k, v) {
    if (!m[k]) {
      m[k] = [];
    }
    m[k].push(v);
  }

  function videoKey (entry) {
    return Math.floor(entry.durationMillis / 1000);
  }

  let imageByKey = {};
  let videoByDuration = {};
  for (let i = 0; i < db.length; i++) {
    let entry = normalize(db[i]);
    if (entry.time != null) {
      multiAdd(imageByKey, entry.time, entry);
    }
    if (entry.durationMillis != null) {
      multiAdd(videoByDuration, videoKey(entry), entry);
    }
  }

  function getCandidates (local) {
    if (local.time != null) {
      return imageByKey[local.time] || [];
    }
    if (local.durationMillis != null) {
      let candidates = videoByDuration[videoKey(local)] || [];
      return candidates.filter(remote => {
        return Math.abs(local.durationMillis - remote.durationMillis) < Math.pow(10, 3 - local.precision);
      });
    }
    return [];
  }

  // some of our images are very old and don't have ModifyDate exif
  function checkPrimitiveImage (local) {
    let basename = path.basename(local);
    for (let i = 0; i < db.length; i++) {
      if (db[i].name === basename && db[i].time == null) {
        return true;
      }
    }
    return false;
  }

  function loop(files) {
    if (files.length === 0) {
      process.exit(0);
    }
    let file = files.shift();

    function checkImage (file) {
      return loadImage(file).then((data) => {
        data = normalize(data);

        let candidates = getCandidates(data);

        if (candidates.length === 0) {
          if (checkPrimitiveImage(file)) {
            console.error('image with no metadata matches: ' + file);
            return 'ok';
          }
          throw ('no matching keys');
        }

        let nameMatches = candidates.filter(x => x.name === data.name);
        if (nameMatches.length === 0) {
          throw ('no matching names');
        }

        if (nameMatches.length === 1) {
          return 'ok';
        } else {
          throw ('too many matches');
        }
      });
    }

    checkImage(file).then(result => {
      if (verbose) {
        console.log(file + ': ' + result);
      }
      loop(files);
    }).catch(err => {
      console.log(file + ': ' + err);
      loop(files);
    });
  }

  var rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  // TODO: This is a bit inefficient by reading everything into memory but who cares
  var files = [];
  rl.on('line', function (file) {
    files.push(file.toString());
  });
  rl.on('close', function () {
    loop(files);
  });
}


program.option('--download')
  .option('--check <db>')
  .option('-v, --verbose')
  .parse(process.argv);

if (program.download) {
  download();
} else if (program.check) {
  ep.open().then(() => {
    check(program.check, program.verbose);
  }).catch(error => {
    console.error('Couldn\'t open exiftool process: ' + error);
    process.exit(1);
  });
}
