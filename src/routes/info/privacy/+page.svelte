<svelte:head><title>Privacy · Housik</title></svelte:head>

<h1>Privacy policy</h1>
<p>
  Housik uses the information you provide to manage shared trips, expenses, payments, receipts and
  photos. Contact the operator at <a href="mailto:chipi.chapa.corporation@gmail.com"
    >chipi.chapa.corporation@gmail.com</a
  > about privacy or deletion requests.
</p>
<h2>Account and trip information</h2>
<p>
  The app stores your name, password hash, session information and the trip information you enter.
  Shared trip records and files are available to trip participants. Invitation pages can show
  participant names, and people with a trip invitation link can join the trip. Share invitation
  links only with people you want to give access.
</p>
<h2>Google Photos</h2>
<p>
  Connecting Google Photos opens Google’s sign-in and photo picker. Housik requests the Google
  Photos Picker permission to access only the photos and videos you explicitly select. It imports
  supported photos and skips videos. It does not request access to your complete library, Google
  contacts or email.
</p>
<p>
  Selected photos and videos are downloaded to Housik’s server, resized and stored with previews for
  the trip gallery. Orientation is corrected and embedded metadata such as GPS coordinates is
  removed from the stored images. Videos are converted to MP4 with embedded metadata removed.
  Persistent Google media identifiers are retained per trip to avoid importing the same photos
  again. Imported copies are visible to trip participants.
</p>
<p>
  Temporary Google access credentials and selection-session data stay on the server. Credentials are
  cleared when an import finishes or is cancelled; abandoned selection sessions expire. Housik does
  not retain a Google refresh token or request your Google password. Each Reload opens Google’s
  account chooser again.
</p>
<p>
  Google Photos data is used to provide the trip gallery and duplicate detection. Housik does not
  sell it, use it for advertising or send imported place photos to an AI service. Housik’s use and
  transfer of information received from Google APIs adheres to the <a
    href="https://developers.google.com/terms/api-services-user-data-policy"
    >Google API Services User Data Policy</a
  >, including its Limited Use requirements.
</p>
<h2>Receipts and storage</h2>
<p>
  Uploaded receipts are stored with the trip. If receipt scanning is enabled, receipt files are sent
  to the configured AI scanning provider to extract expense items; manual review is available when
  scanning is unavailable. This receipt-scanning flow is separate from the place-photo gallery.
</p>
<p>
  Files and credentials are stored on the server with restricted filesystem permissions. Serving
  trip files requires an authorized trip session. The app uses a session cookie to keep you signed
  in and browser storage for functions such as resuming a photo selection. Its offline cache
  contains public application assets rather than private trip data.
</p>
<h2>Removal and retention</h2>
<p>
  Trip data and imported photos remain until removed or a deletion request is processed. Any trip
  participant can remove a place photo through its viewer; this removes the gallery record and its
  stored image files. The Google media identifier remains as an import-history record so Reload will
  not restore that photo. Removing a copy from Housik does not delete the original from Google
  Photos. Backup copies, where retained, may persist after active files are removed.
</p>
<p>
  You can revoke Google access through <a href="https://myaccount.google.com/connections"
    >your Google account connections</a
  >. Revocation prevents further authorized access but does not remove copies already imported into
  a trip. To request deletion of your account, trip records or import history, contact the operator
  using the address above and identify the relevant account or trip.
</p>
