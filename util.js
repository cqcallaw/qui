function addDelimiter(str, delimiter, n) {
	out = '';
	out += str.charAt(0);
	for (i = 1; i < str.length; i++) {
		if (i % n === 0) {
			out += delimiter;
		}
		out += str.charAt(i);
	}

	return out;
}

// ref: https://stackoverflow.com/a/54261558/577298
// ref: https://stackoverflow.com/a/2274327/577298
const readStorage = key =>
	new Promise((resolve, reject) =>
		chrome.storage.local.get([key], result =>
			chrome.runtime.lastError
				? reject(Error(chrome.runtime.lastError.message))
				: resolve(result)
		)
	)

const writeStorage = (key, value) =>
	new Promise((resolve, reject) =>
		chrome.storage.local.set({ [key]: value }, () =>
			chrome.runtime.lastError
				? reject(Error(chrome.runtime.lastError.message))
				: resolve()
		)
	)
