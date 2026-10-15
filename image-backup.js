// Backup copies of product images on Cloudinary. The catalog's primary links live on free hosts
// (catbox.moe, postimg, ...) that drop connections, so every image can have a secondary link that
// the catalog falls back to when the primary fails to load.

export const DEFAULT_CLOUD_NAME = 'dzpbfgknp';

// A slow or dead source must fail with a message instead of leaving the UI waiting forever.
const UPLOAD_TIMEOUT_MS = 40000;

// primary / backup / origin are Firestore field names on the product document. "origin" remembers
// which primary URL a backup was made from, so a changed primary is detected as stale.
export const BACKUP_FIELDS = [
    { key: 'photo', label: 'Foto del producto', primary: 'Imagen', backup: 'ImagenRespaldo', origin: 'ImagenRespaldoOrigen' },
    { key: 'drawing', label: 'Dibujo de dimensiones', primary: 'Dibujo', backup: 'DibujoRespaldo', origin: 'DibujoRespaldoOrigen' },
    { key: 'context', label: 'Imagen en contexto', primary: 'ImgContexto', backup: 'ImgContextoRespaldo', origin: 'ImgContextoRespaldoOrigen' }
];

export function isCloudinaryUrl(url) {
    return /^https?:\/\/res\.cloudinary\.com\//i.test(url || '');
}

export function isBackupConfigured(config) {
    return Boolean(config && config.cloudName && config.uploadPreset);
}

async function postToCloudinary(config, file) {
    const body = new FormData();
    body.append('file', file);
    body.append('upload_preset', config.uploadPreset);
    body.append('folder', 'sielu-respaldo');
    const response = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`, {
        method: 'POST', body, signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS)
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || !json.secure_url) {
        throw new Error(json.error?.message || `Cloudinary respondió ${response.status}`);
    }
    return json.secure_url;
}

// First lets Cloudinary download the image itself (no bandwidth through the browser). If the
// source host refuses Cloudinary's fetcher, downloads it here and uploads the bytes instead.
export async function uploadToCloudinary(url, config) {
    try {
        return await postToCloudinary(config, url);
    } catch (remoteError) {
        let blob;
        try {
            const response = await fetch(url, { mode: 'cors', signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            blob = await response.blob();
        } catch (downloadError) {
            throw remoteError;
        }
        return postToCloudinary(config, blob);
    }
}
