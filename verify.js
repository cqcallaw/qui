request_timeout = 3000;

const sleep = (milliseconds) => {
	return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function has_keys(keys, dict) {
	for (let i = 0; i < keys.length; i++) {
		if (!(keys[i] in dict)) {
			return false;
		}
	}
	return true;
}

async function get_signature(url) {
	let signature = null;

	// TODO: handle binary signatures
	const sig_url = url + ".asc"
	console.log("Checking for", sig_url);

	const request = await fetch(sig_url);
	const response = await request.text();
	signature = await openpgp.signature.readArmored(response);

	return signature;
}

async function get_pubkey(url) {
	let pubkey = null;

	let base_url = new URL(url);
	base_url.pathname = "pubkey.asc";
	console.log("Checking for", base_url.toString());

	const request = await fetch(base_url);
	const response = await request.text();
	pubkey = await openpgp.key.readArmored(response);

	return pubkey;
}

async function verify() {
	var url = 'http://bafybeid47er4kmydp7lfgwpsnia2g34qrxhrb4ar3xxo5g2vrpvxf2dx2u.ipfs.localhost:8080/'
	if (typeof(window) !== 'undefined') {
		url = window.location.href;
	}

	console.log("Verifying", url)

	if (url.substr(-1) === '/') {
		console.log(url, "does not contain path information, checking for real path...")
		// ref: https://stackoverflow.com/a/10926978/577298
		real_url_dict = {}
		path_names = ['index', 'index.html']

		// send async HTTP requests for each possible real path
		path_names.forEach(key => {
			const request = new XMLHttpRequest();
			request.timeout = request_timeout;
			const real_url = url + key;
			console.log("Checking", real_url);
			request.onreadystatechange = function () {
				if (request.readyState === 4) {
					console.log(real_url, "result", request.status);
					real_url_dict[key] = request.status;
				}
			}
			request.open('GET', real_url, true);
			request.send();
		})

		// wait for all async requests to finish
		const timeout = request_timeout + 1000;
		const sleep_interval = 250;
		let count = 0;
		console.log("Waiting for real path requests to complete...");
		while (!has_keys(path_names, real_url_dict) && count <= timeout) {
			await sleep(sleep_interval);
			count += sleep_interval;
		}

		if (!has_keys(path_names, real_url_dict)) {
			console.log("Failed to query real URL.")
			return;
		}

		let real_url = ""
		for (const key in real_url_dict) {
			if (real_url_dict[key] >= 200 && real_url_dict[key] < 300) {
				real_url = url + key;
				break;
			}
		}

		if (real_url === "") {
			console.log("No valid real URL found.")
			return;
		}

		url = real_url;
		console.log("Using real URL", url);
	}

	signature = await get_signature(url);
	if (signature == null) {
		console.log("Failed to obtain signature file.");
		return;
	}
	console.log(signature);

	pubkey = await get_pubkey(url);
	if (pubkey == null) {
		console.log("Failed to obtain public key.");
		return;
	}
	console.log(pubkey);

	const request = await fetch(url);
	const message = await request.text();

	const verified = await openpgp.verify({
		message: openpgp.cleartext.fromText(message),
		signature: signature,
		publicKeys: pubkey.keys,
		detached: true
	})

	console.log(verified);

	const { valid } = verified.signatures[0];
	if (valid) {
		console.log('signed by key id ' + verified.signatures[0].keyid.toHex());
	} else {
		console.log('Failed to verify', url);
	}
}

verify();

