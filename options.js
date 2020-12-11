function removeKey(hostname) {
	console.log("Removing host entry", hostname);
	if (confirm('Delete host entry' + hostname + '?')) {
		console.log('Begin removal');
		chrome.storage.sync.remove(hostname);
	} else {
		console.log('User cancelled host removal.');
	}
}

async function generateKeyList() {
	chrome.storage.sync.get(null, async function (entries) {
		let keyList = document.getElementById('key-list');
		keyList.textContent = '';
		for (let hostname in entries) {
			console.log("Found hostname", hostname);

			// add hostname
			let keyElement = document.createElement('dt');
			keyElement.appendChild(document.createTextNode(hostname));
			keyList.appendChild(keyElement);

			// add pubkey fingerprint
			let pubkey = await openpgp.key.readArmored(entries[hostname])
			let fingerprint = pubkey.keys[0].getFingerprint();
			fingerprint = addDelimiter(fingerprint, ' ', 4).toUpperCase();
			let valueElement = document.createElement('dd');
			valueElement.appendChild(document.createTextNode(fingerprint));

			// add delete button
			let delButton = document.createElement('input');
			delButton.type = 'button';
			delButton.value = 'Remove';
			delButton.className = 'remove';
			delButton.onclick = () => removeKey(hostname);
			valueElement.appendChild(delButton);

			keyList.appendChild(valueElement);
		}
	});
}

chrome.storage.onChanged.addListener(function (changes, namespace) {
	console.log("Storage change, reloading...");
	generateKeyList();
});

generateKeyList();
