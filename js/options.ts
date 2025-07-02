// Assuming SETTINGS is globally available from settings.ts
// and has AppSettings interface defined in settings.ts
declare var SETTINGS: {
    max_scrobbles: number;
    logs_enabled?: boolean;
    scrobble_interval: number;
    history_sync_interval?: number;
    // Add other properties of SETTINGS if they are used here
};

interface StorageData {
    [key: string]: string;
}

// Saves options to chrome.storage.local.
function save_options(): void {
    const scrobbleMultCheckbox = document.getElementById('scrobble_mult') as HTMLInputElement | null;
    const logsEnabledCheckbox = document.getElementById('log_checkbox') as HTMLInputElement | null;
    const customIntervalInput = document.getElementById('history_sync_interval') as HTMLInputElement | null;

    const storageData: StorageData = {};
    let scrobble_mult = false;

    if (scrobbleMultCheckbox) {
        scrobble_mult = scrobbleMultCheckbox.checked;
        if (!scrobble_mult) {
            storageData['max_scrobbles'] = '1';
        }
    }

    let logs_enabled = false;
    if (logsEnabledCheckbox) {
        logs_enabled = logsEnabledCheckbox.checked;
        if (logs_enabled) { // Only store if true, remove if false
            storageData['logs_enabled'] = 'true';
        }
    }

    // Save history sync interval based on selected option
    const selectedOption = document.querySelector('input[name="sync_interval"]:checked') as HTMLInputElement | null;
    let intervalVal = 0;
    if (selectedOption) {
        if (selectedOption.value === 'custom' && customIntervalInput) {
            const customVal = parseInt(customIntervalInput.value, 10);
            intervalVal = !isNaN(customVal) && customVal > 0 ? customVal : 0;
        } else {
            intervalVal = parseInt(selectedOption.value, 10);
            if (isNaN(intervalVal)) intervalVal = 0; // Ensure it's a number
        }
    }

    storageData['history_sync_interval'] = intervalVal.toString();

    chrome.storage.local.set(storageData, () => {
        if (chrome.runtime.lastError) {
            console.error("Error setting storage:", chrome.runtime.lastError.message);
        }
        // Remove settings that shouldn't be stored (when options are effectively disabled or default)
        const keysToRemove: string[] = [];
        if (scrobble_mult) { // if checked, means max_scrobbles is NOT '1', so remove our marker
            keysToRemove.push('max_scrobbles');
        }
        if (!logs_enabled) { // if not checked, ensure logs_enabled is removed
            keysToRemove.push('logs_enabled');
        }

        if (keysToRemove.length > 0) {
            chrome.storage.local.remove(keysToRemove, () => {
                if (chrome.runtime.lastError) {
                    console.error("Error removing storage keys:", chrome.runtime.lastError.message);
                }
            });
        }
    });

    // Tell service worker to reload settings
    chrome.runtime.sendMessage({cmd: 'reloadSettings'}, function() {
        if (chrome.runtime.lastError) {
            console.error("Error sending reloadSettings message:", chrome.runtime.lastError.message);
        }
        const status = document.getElementById('status');
        if (status) {
            status.textContent = 'Options saved. Some changes may require reloading the music player page.';
            setTimeout(() => {
                if (status) status.textContent = '';
            }, 3500);
        }
    });
}


// Restores select box state to saved value from SETTINGS.
function restore_options(): void {
    const scrobbleMultCheckbox = document.getElementById('scrobble_mult') as HTMLInputElement | null;
    const logCheckbox = document.getElementById('log_checkbox') as HTMLInputElement | null;
    const minuteField = document.getElementById('minute_field') as HTMLElement | null;

    if (scrobbleMultCheckbox) {
        scrobbleMultCheckbox.checked = SETTINGS.max_scrobbles > 1;
    }
    if (logCheckbox) {
        logCheckbox.checked = !!SETTINGS.logs_enabled;
    }
    if (minuteField) {
        minuteField.textContent = Math.round((SETTINGS.scrobble_interval / 60) * 100) / 100 + '';
    }

    // Restore history sync interval and set radio buttons
    const intervalVal = SETTINGS.history_sync_interval !== undefined ? SETTINGS.history_sync_interval : 0; // Default to 0 if undefined

    let radioSet = false;
    const radioMapping: {[key: number]: string} = {
        0: 'sync_interval_disabled',
        60: 'sync_interval_60',
        360: 'sync_interval_360',
        1440: 'sync_interval_1440'
    };

    const radioIdToSelect = radioMapping[intervalVal];
    if (radioIdToSelect) {
        const radioToSelect = document.getElementById(radioIdToSelect) as HTMLInputElement | null;
        if (radioToSelect) {
            radioToSelect.checked = true;
            radioSet = true;
        }
    }

    const customRadio = document.getElementById('sync_interval_custom') as HTMLInputElement | null;
    if (!radioSet && customRadio) {
        customRadio.checked = true;
    }

    const customInput = document.getElementById('history_sync_interval') as HTMLInputElement | null;
    if (customInput) {
        customInput.value = intervalVal > 0 ? intervalVal.toString() : ''; // Show positive values, clear for 0
        customInput.disabled = !(customRadio && customRadio.checked);
    }
}

document.addEventListener('DOMContentLoaded', restore_options);

const saveButton = document.querySelector('#save');
if (saveButton) {
    saveButton.addEventListener('click', save_options);
}

// Toggle custom input enable state when radio buttons change
const radioButtons = document.querySelectorAll('input[name="sync_interval"]');
radioButtons.forEach((radio) => {
    radio.addEventListener('change', function(event) {
        const currentTarget = event.currentTarget as HTMLInputElement;
        const customInput = document.getElementById('history_sync_interval') as HTMLInputElement | null;
        if (customInput) {
            if (currentTarget.value === 'custom') {
                customInput.disabled = false;
                customInput.focus();
            } else {
                customInput.disabled = true;
            }
        }
    });
});
