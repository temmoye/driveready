const year = new Date().getFullYear();

function trimValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function defaultDocsBaseUrl() {
  return 'https://github.com/temmoye/driveready/blob/codex/driveready-review/legal';
}

function legalDocUrl(fileName, explicitValue) {
  const explicit = trimValue(explicitValue);

  if (explicit) {
    return explicit;
  }

  return `${trimValue(process.env.DRIVEREADY_PUBLIC_DOCS_BASE_URL) || defaultDocsBaseUrl()}/${fileName}`;
}

const supportUrl = legalDocUrl('support.md', process.env.DRIVEREADY_SUPPORT_URL);
const privacyPolicyUrl = legalDocUrl('privacy-policy.md', process.env.DRIVEREADY_PRIVACY_POLICY_URL);
const marketingUrl = trimValue(process.env.DRIVEREADY_MARKETING_URL) || supportUrl;

module.exports = {
  configVersion: 0,
  apple: {
    copyright: `${year} DriveReady`,
    info: {
      'en-US': {
        title: 'DriveReady UK',
        subtitle: 'MOT, docs, trip checks',
        description:
          'Keep vehicle reminders, documents, and trip readiness in one place. DriveReady helps you track MOT, tax, insurance, expiring files, charge-zone checks, and refuel options before you leave. Parking guidance is not part of the current release.',
        keywords: ['vehicle', 'mot', 'tax', 'insurance', 'documents', 'trip check', 'uk'],
        marketingUrl,
        supportUrl,
        privacyPolicyUrl,
      },
    },
  },
};
