async function removeKey(keyClass, index, fingerprint) {
	console.log("Removing key", fingerprint);
	if (confirm('Delete key with fingerprint ' + fingerprint.toUpperCase() + '?')) {
		console.log('Begin removal');

		let out = []
		let pubkeys = await readStorage(keyClass);
		for (let i = 0; i < pubkeys.length; i++) {
			if (i != index) {
				out.push(pubkeys[keyClass][i]);
			}
		}

		console.log("output", pubkeys);

		await writeStorage(keyClass, out)

	} else {
		console.log('User cancelled host removal.');
	}
}

async function generateKeyList(keyClass) {
	console.log("Generating key list for class", keyClass);
	let keyList = document.getElementById(keyClass);
	keyList.textContent = '';
	let pubkey_result = await readStorage(keyClass);
	let pubkeys = pubkey_result[keyClass];
	if (typeof (pubkeys) !== 'undefined') {
		for (let i = 0; i < pubkeys.length; i++) {
			let pubkey_text = pubkeys[i];
			let pubkey_result = await openpgp.key.readArmored(pubkey_text);
			if ('err' in pubkey_result) {
				console.log("Error parsing pubkey", pubkey_result.err);
			} else {
				for (const pubkey of pubkey_result.keys) {
					// add fingerprint
					let fingerprintElement = document.createElement('dt');
					let fingerprint = pubkey.getFingerprint();
					fingerprintElement.innerHTML = fingerprint.toUpperCase();

					// add delete button
					let delButton = document.createElement('input');
					delButton.type = 'button';
					delButton.value = 'Remove';
					delButton.className = 'remove';
					delButton.onclick = () => removeKey(keyClass, i, fingerprint);
					fingerprintElement.appendChild(delButton);

					keyList.appendChild(fingerprintElement);

					// add user IDs
					let userIds = pubkey.getUserIds();
					// add in reverse order; primary UID is last in the array
					for (let j = userIds.length - 1; j >= 0; j--) {
						let userIdElement = document.createElement('dd');
						userIdElement.className = 'user_id';
						userIdElement.appendChild(document.createTextNode(userIds[j]));
						keyList.appendChild(userIdElement);
					}
				}
			}
		}
	}
}

async function setupOptions() {
	let trustPromptResult = await readStorage('trust_prompt');
	let trustPrompt = trustPromptResult.trust_prompt;
	let trustPromptElement = document.getElementById('trust_prompt');
	trustPromptElement.checked = trustPrompt;
	trustPromptElement.addEventListener('change', function () {
		writeStorage('trust_prompt', this.checked);
	});
}

chrome.storage.onChanged.addListener(function (changes, namespace) {
	console.log("Storage change, reloading...");
	generateKeyList('trusted');
});

window.addEventListener('load', (event) => {
	generateKeyList('trusted');
	setupOptions();
});
