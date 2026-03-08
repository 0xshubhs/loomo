/**
 * Upload a blob to a presigned URL with progress tracking.
 * Uses XMLHttpRequest instead of fetch to support upload progress events.
 */
export function uploadToPresignedUrl(
  url: string,
  blob: Blob,
  onProgress?: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        const pct = Math.round((e.loaded / e.total) * 100);
        onProgress(pct);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed with status ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('Upload network error'));
    xhr.ontimeout = () => reject(new Error('Upload timed out'));

    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', blob.type);
    xhr.send(blob);
  });
}
