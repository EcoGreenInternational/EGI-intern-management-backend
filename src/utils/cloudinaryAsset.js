// utils/cloudinaryAsset.js – small helpers for Cloudinary-hosted files.

// Delivery URLs look like https://res.cloudinary.com/<cloud>/<image|raw|video>/upload/...
const resourceTypeFromUrl = (url = "") => {
  const m = /\/(image|raw|video)\/upload\//.exec(String(url));
  return m ? m[1] : "image";
};

module.exports = { resourceTypeFromUrl };
