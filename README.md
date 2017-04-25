# google-drive-hashes

I wanted to upload thousands of files to Google Photos. Google Photos Backup application doesn't give any feedback, though, as which photos were uploaded and which weren't.

This is a silly method of giving me some confidence:
- for photos I check that there's a photo on Google Drive with identical time and file name
- for videos I check duration and file name as Google doesn't give any more metadata

This app is written on top of a very nice google drive quickstart tutorial. You have to do everything that's there to run it:
https://developers.google.com/drive/v3/web/quickstart/nodejs
