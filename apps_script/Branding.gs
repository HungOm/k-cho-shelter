/*
 * The raffle's own mark and colour, on the Sheet backend.
 *
 * Raffled is a product; the raffle belongs to whoever runs it. The Supabase
 * half stores the logo in a bucket that exists only for branding. Drive has no
 * bucket — world-readable is a per-file permission on a file that lives in
 * somebody's personal Drive, under their quota, and ownership follows that
 * person out of the organisation.
 *
 * So the folder is shared once, at creation, and uploads inherit it. That is
 * the least-bad shape available here, and the question underneath it is not
 * technical: whoever owns this Sheet also owns the organisation's public
 * branding, and should know that.
 */

/** Where logos live. Created on first upload, shared once. */
function logoFolder_() {
  // Same reasoning as backupFolder_: this names a folder that EXISTS in Drive
  // with files already in it. Changing the string silently starts a second
  // folder and orphans everything in the first — a string that LOCATES rather
  // than names, and nothing in the syntax says which you are looking at.
  var name = 'Raffled Branding';
  var it = DriveApp.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  var folder = DriveApp.createFolder(name);
  // Shared once here rather than per file: a logo renders on a receipt and in
  // the app for anybody signed in on any device, so it has to be fetchable
  // without a Google session.
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return folder;
}

/** 512 KB, the same limit the Supabase half enforces. */
var LOGO_MAX_BYTES = 512 * 1024;

var LOGO_TYPES = {
  'image/png':  { ext: 'png' },
  'image/jpeg': { ext: 'jpg' },
  'image/webp': { ext: 'webp' }
};

/*
 * WHAT THE FILE ACTUALLY IS, not what it says it is.
 *
 * The filename and the declared type are both supplied by whoever picked the
 * file, and a browser reports image/png for a renamed SVG without hesitating.
 * An SVG can carry script and would be served to a browser from a link the app
 * hands out, so it is refused on CONTENT. The filename is never consulted: the
 * stored name is ours.
 */
function sniffImage_(bytes) {
  function starts(sig, at) {
    at = at || 0;
    for (var i = 0; i < sig.length; i++) if (bytes[at + i] !== sig[i]) return null;
    return true;
  }
  if (starts([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])) return 'image/png';
  if (starts([0xFF, 0xD8, 0xFF])) return 'image/jpeg';
  // RIFF alone is also WAV and AVI, so the WEBP tag at offset 8 is required.
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  var head = '';
  for (var j = 0; j < Math.min(64, bytes.length); j++) head += String.fromCharCode(bytes[j] & 0xFF);
  if (/^\s*(<\?xml|<svg)/i.test(head)) return 'image/svg+xml';
  return null;
}

function checkLogoBytes_(b64, declared, which) {
  var clean = String(b64 || '').replace(/^data:[^,]*,/, '').replace(/\s/g, '');
  if (!clean) throw new ApiError('MISSING_FIELD', 'No image was sent.');
  var bytes;
  try {
    bytes = Utilities.base64Decode(clean);
  } catch (e) {
    throw new ApiError('BAD_IMAGE', 'That file could not be read. Try choosing it again.');
  }
  if (bytes.length > LOGO_MAX_BYTES) {
    throw new ApiError('IMAGE_TOO_BIG',
      'That ' + which + ' is ' + Math.round(bytes.length / 1024) + ' KB. The limit is ' +
      (LOGO_MAX_BYTES / 1024) + ' KB — a logo drawn at 40px does not need more, and ' +
      'volunteers open this on mobile data.');
  }
  var real = sniffImage_(bytes);
  if (real === 'image/svg+xml') {
    throw new ApiError('SVG_REFUSED',
      'SVG logos cannot be accepted, because an SVG can carry code. ' +
      'Save it as a PNG and upload that instead.');
  }
  if (!real || !LOGO_TYPES[declared]) {
    throw new ApiError('BAD_IMAGE', 'That file is not a PNG, JPEG or WebP image.');
  }
  // A genuine picture under the wrong name gets its own sentence: it is almost
  // always a mistake, and "unreadable" sends somebody hunting the wrong problem.
  if (real !== declared) {
    throw new ApiError('WRONG_IMAGE_TYPE',
      'That file is named as ' + declared + ' but is really ' + real + '. ' +
      'Re-save it, or choose it again.');
  }
  return bytes;
}

function handleUploadLogo(payload, user) {
  if (payload.remove) {
    setConfigValue_('ORG_LOGO', '');
    setConfigValue_('ORG_LOGO_SMALL', '');
    logAudit('LOGO_REMOVED', {}, user.email);
    return { config: whoamiConfig_() };
  }

  var declared = String(payload.contentType || '');
  var big = checkLogoBytes_(payload.data, declared, 'logo');
  var small = payload.dataSmall ? checkLogoBytes_(payload.dataSmall, declared, 'small logo') : null;

  var folder = logoFolder_();
  var ext = LOGO_TYPES[declared].ext;
  var stamp = new Date().getTime();

  function put(name, bytes) {
    var file = folder.createFile(Utilities.newBlob(bytes, declared, name));
    // The folder is already shared, but a file created in it does not always
    // inherit that in every Drive configuration, so it is set explicitly. A
    // logo that 404s for everyone but the uploader looks like a broken app.
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return 'https://drive.google.com/uc?export=view&id=' + file.getId();
  }

  var bigUrl = put('logo-' + stamp + '.' + ext, big);
  var smallUrl = small ? put('logo-' + stamp + '-small.' + ext, small) : '';

  setConfigValue_('ORG_LOGO', bigUrl);
  setConfigValue_('ORG_LOGO_SMALL', smallUrl);
  logAudit('LOGO_UPLOADED',
    { bytes: big.length, smallBytes: small ? small.length : 0, type: declared }, user.email);
  return { config: whoamiConfig_() };
}

function handleSetBrandColor(payload, user) {
  var raw = String(payload.color == null ? '' : payload.color).trim();
  if (raw === '') {
    setConfigValue_('BRAND_COLOR', '');
    return { config: whoamiConfig_() };
  }
  var hex = raw.charAt(0) === '#' ? raw : '#' + raw;
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex)) {
    throw new ApiError('BAD_COLOUR',
      '"' + raw + '" is not a colour. It should look like #0B7285 — six letters or ' +
      'numbers after a hash. Leave it empty to use the standard colour.');
  }
  setConfigValue_('BRAND_COLOR', hex.toLowerCase());
  logAudit('BRAND_COLOR', { colour: hex }, user.email);
  return { config: whoamiConfig_() };
}
