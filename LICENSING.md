# Licensing

Short version: **mox is MIT-licensed, which means you can sell it.** This page
explains what that does and does not give you. It is a plain-language summary,
not legal advice — for a commercial launch, have a lawyer read your terms.

## The code: MIT

`LICENSE` is the standard MIT license. It permits use, modification,
distribution, and **commercial use**, including selling binaries or preinstalled
machines. The one condition that matters commercially:

> The copyright notice and permission notice must be included in all copies or
> substantial portions of the Software.

So if you redistribute mox, ship the `LICENSE` file with it (the release script
copies it into the tarball) and don't strip the notice from the source.

## What MIT does not give you

- **No warranty.** The license says the software is provided "as is". If you sell
  it, your own terms — not MIT — define what you promise a buyer. Put refunds,
  support scope, and liability limits in writing, and check what your
  jurisdiction requires for consumer software.
- **No trademark rights.** MIT covers code, not names. If you sell under your own
  brand, rename it (the name appears in `package.json`, the CLI banner, the
  desktop entry, and `docs/`). Don't imply endorsement by the original authors.
- **No rights to model weights or Ollama.** mox ships no model. Ollama, LM Studio,
  llama.cpp, and each model have their own licenses — several open-weight models
  have commercial-use restrictions (check the model card, not the download
  button). This is the most common licensing mistake in AI products.
- **No rights to your customers' data.** If your build sends prompts to a remote
  model, that's your privacy policy's problem, and it must be disclosed.

## Bundled vs. fetched

The release tarball contains only MIT code from this repository. It does not
contain Node.js (downloaded from nodejs.org under its own license) or any model
(downloaded by the user under the model's license). If you build a *preloaded*
product, you are redistributing those separately — comply with each.

## Attribution you can use

A "Powered by mox (MIT)" line in an About box is accurate and costs nothing. It
is not required by the license, but it's honest.
