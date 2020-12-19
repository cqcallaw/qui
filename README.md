# Qui

Verify the authenticity of Web3 documents signed by [PGP](https://en.wikipedia.org/wiki/Pretty_Good_Privacy).

## Browser Support

Tested in Chrome and Brave.

## Installation

Install the unpacked extension in developer mode; if there's demand, I'll look into publishing it on the Web Store.

## Basic Usage

When the user browses a Web3 page, Qui will verify the authenticity of any documents for which a detached PGP signature is provided. If verification succeeds, a green check mark will be displayed. Otherwise, a caution icon will indicate the authenticity of the content cannot be verified.

To minimize complexity, Qui maintains an independent keystore. Trusted keys may be imported on the extension's Settings page; Qui will also prompt users to trust a site-provided public key if the option `Prompt for Site-provided Public Keys` is enabled.

## Site Configuration

To enable support for Qui, distribute detached signatures for every published file. Signature files must have the same path as the signed file plus a `.sig` extension. For all but the smallest sites, [parallel signing](https://github.com/cqcallaw/www/blob/cf8441b00d4f5ec5543556c1f4ad7021cd4535e0/sign.py) expedites the signing process considerably.

If the file `/pubkey.asc` exists, Qui may use this file to verify document authenticity.

## Credits

Qui makes extensive use of [OpenPGP.js](https://openpgpjs.org/). Icons are licensed under the Creative Commons:

* [Warning](https://commons.wikimedia.org/wiki/File:Warning_sign_font_awesome-red.svg)
* [Check Mark](https://commons.wikimedia.org/wiki/File:MW-Icon-CheckMark.svg)
* [Question Mark](https://commons.wikimedia.org/wiki/File:Question_mark_alternate.svg)
* [Settings](https://commons.wikimedia.org/wiki/File:Ic_settings_48px.svg)
