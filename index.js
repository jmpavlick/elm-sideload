const os = require('os');
const path = require('path');

function getElmHome() {
  // Check for ELM_HOME environment variable first
  const maybeCustomHome = process.env.ELM_HOME;
  
  if (maybeCustomHome) {
    return maybeCustomHome;
  }
  
  // Fall back to platform-specific app user data directory
  return getAppUserDataDirectory('elm');
}

function getAppUserDataDirectory(appName) {
  const platform = os.platform();
  const homeDir = os.homedir();
  
  switch (platform) {
    case 'win32':
      // Windows: %APPDATA%\appName
      return path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), appName);
      
    default:
      // Unix-like systems (macOS, Linux, etc.): ~/.appName
      return path.join(homeDir, '.' + appName);
  }
}

console.log("hello world");
console.log("Elm home:", getElmHome());

module.exports = {
  getElmHome,
  getAppUserDataDirectory
}; 