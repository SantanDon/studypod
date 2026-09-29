/** Missing ownership is not permission to claim a legacy upload. */
export function isOwnedAudiobookManifest(manifest, ownerId) {
    return typeof ownerId === 'string' && ownerId.length > 0 &&
        typeof manifest?.ownerId === 'string' && manifest.ownerId === ownerId;
}
/** Serializes admission only, not rendering; uses the app's existing durable jobs after admission. */
export function createAudiobookAdmissionGuard({ ownerFor, fileFor }) {
    const admitting = new Set();
    return (req, res, next) => {
        const owner = ownerFor(req);
        const rawFile = req.body?.fileName;
        if (!owner)
            return res.status(401).json({ error: 'Authentication required' });
        if (typeof rawFile !== 'string' || !rawFile.trim() || rawFile.length > 255) {
            return res.status(400).json({ error: 'A valid book fileName is required' });
        }
        const key = JSON.stringify([owner, fileFor(rawFile)]);
        if (admitting.has(key))
            return res.status(409).json({ error: 'An audiobook request for this book is already being prepared. Check its status before retrying.' });
        admitting.add(key);
        const release = () => {
            admitting.delete(key);
            delete res.locals.releaseAudiobookAdmission;
        };
        res.locals ||= {};
        // The controller releases in finally. A disconnected response must not unlock
        // admission while asynchronous setup is still writing the durable job.
        res.locals.releaseAudiobookAdmission = release;
        try {
            next();
        }
        catch (error) {
            release();
            throw error;
        }
    };
}
