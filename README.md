# pdac-lint

**Status: planned. Nothing here is usable yet.**

This will be an independent conformance runner for the
[Product Definition as Code specification](https://github.com/product-definition-as-code/spec):
a CLI, a GitHub Action and a conformance badge, built against the spec's fixtures rather than
against ProductShape's internals, so that conformance stops being self-referential.

It does not exist yet because the versioned conformance corpus it must run does not exist yet.
Corpus first, runner second, badge last. Anything else would be a badge that certifies nothing.

When it ships, a badge will state exactly what was checked, spec version, conformance level and
profile, never a bare "PDaC conformant".

If the organization profile or any page says this is usable today, that page is wrong and
[we want to know](https://github.com/product-definition-as-code/spec/issues).
