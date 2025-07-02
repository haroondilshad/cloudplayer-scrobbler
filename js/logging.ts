function log(message: any): void {
  // Assuming SETTINGS is a global variable initialized elsewhere (e.g., in settings.ts)
  // and that settings.ts is loaded before this script.
  if (typeof SETTINGS !== 'undefined' && SETTINGS.logs_enabled) {
    console.log(message);
  }
}