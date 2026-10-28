// The source app.json remains the full HTTPS configuration. This explicit profile
// changes only the generated lab project; it never changes the product app.
module.exports = ({ config }) => {
  const profile = process.env.PORTOFOLIO_LAB_PROFILE || 'full-https';
  if (!['full-https', 'limited-personal-team'].includes(profile)) {
    throw new Error(`Unknown Nearby Lab profile: ${profile}`);
  }
  const ios = {
    ...config.ios,
    infoPlist: { ...config.ios?.infoPlist, PortofolioLabProfile: profile },
  };
  if (profile === 'limited-personal-team') {
    delete ios.associatedDomains;
    ios.buildNumber = '2';
  }
  return { ...config, ios };
};
