// Saves options to localStorage.
function save_options() {
    var scrobble_mult = document.getElementById('scrobble_mult').checked;
    if (!scrobble_mult) {
        // TODO localStorage actually stores this as a string. Find out
        // if this causes bugs.
        localStorage.setItem('max_scrobbles', 1);
    } else {
        localStorage.removeItem('max_scrobbles');
    }

    var logs_enabled = document.getElementById('log_checkbox').checked;
    if (logs_enabled) {
        localStorage.setItem('logs_enabled', 'true');
    } else {
        localStorage.removeItem('logs_enabled');
    }

    // Save history sync interval based on selected option
    var selectedOption = document.querySelector('input[name="sync_interval"]:checked');
    var intervalVal = 0;
    if (selectedOption) {
        if (selectedOption.value === 'custom') {
            var customVal = parseInt(document.getElementById('history_sync_interval').value, 10);
            intervalVal = !isNaN(customVal) && customVal > 0 ? customVal : 0;
        } else {
            intervalVal = parseInt(selectedOption.value, 10);
        }
    }

    // Always store the selected interval (including 0) so the background script
    // can distinguish between an explicit "disabled" and the default.
    localStorage.setItem('history_sync_interval', intervalVal);

    chrome.runtime.getBackgroundPage(function(backgroundPage) {
        backgroundPage.location.reload();
        // Update status to let user know options were saved.
        var status = document.getElementById('status');
        status.innerHTML = 'Options saved, please reload the Google Play page.';
        setTimeout(function() {
            status.innerHTML = '';
        }, 3500);
    });
}


// Restores select box state to saved value from localStorage.
function restore_options() {
    var scrobble_mult = SETTINGS.max_scrobbles > 1;
    document.getElementById('scrobble_mult').checked = scrobble_mult;
    document.getElementById('log_checkbox').checked = SETTINGS.logs_enabled;
    document.getElementById('minute_field').innerHTML =
            Math.round((SETTINGS.scrobble_interval / 60) * 100) / 100;

    // Restore history sync interval and set radio buttons
    var intervalVal = SETTINGS.history_sync_interval || 0;

    var radioSet = false;
    if (intervalVal === 0) {
        document.getElementById('sync_interval_disabled').checked = true;
        radioSet = true;
    } else if (intervalVal === 60) {
        document.getElementById('sync_interval_60').checked = true;
        radioSet = true;
    } else if (intervalVal === 360) {
        document.getElementById('sync_interval_360').checked = true;
        radioSet = true;
    } else if (intervalVal === 1440) {
        document.getElementById('sync_interval_1440').checked = true;
        radioSet = true;
    }

    if (!radioSet) {
        document.getElementById('sync_interval_custom').checked = true;
    }

    var customInput = document.getElementById('history_sync_interval');
    customInput.value = intervalVal > 0 ? intervalVal : '';
    customInput.disabled = !document.getElementById('sync_interval_custom').checked;
}


document.addEventListener('DOMContentLoaded', restore_options);
document.querySelector('#save').addEventListener('click', save_options);

// Toggle custom input enable state when radio buttons change
var radioButtons = document.querySelectorAll('input[name="sync_interval"]');
radioButtons.forEach(function(radio) {
    radio.addEventListener('change', function() {
        var customInput = document.getElementById('history_sync_interval');
        if (this.value === 'custom') {
            customInput.disabled = false;
            customInput.focus();
        } else {
            customInput.disabled = true;
        }
    });
});
