# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [1.3.0](https://github.com/Agoric/agoric-sdk/compare/@agoric/transform-metering@1.2.5...@agoric/transform-metering@1.3.0) (2020-06-30)


### Features

* **transform-metering:** add balance-getters to refillFacet ([8200188](https://github.com/Agoric/agoric-sdk/commit/82001883bd8313075882eedb5e33789c5871241e))





## [1.2.5](https://github.com/Agoric/agoric-sdk/compare/@agoric/transform-metering@1.2.4...@agoric/transform-metering@1.2.5) (2020-05-17)


### Bug Fixes

* remove many build steps ([6c7d3bb](https://github.com/Agoric/agoric-sdk/commit/6c7d3bb0c70277c22f8eda40525d7240141a5434))





## [1.2.4](https://github.com/Agoric/agoric-sdk/compare/@agoric/transform-metering@1.2.3...@agoric/transform-metering@1.2.4) (2020-05-10)

**Note:** Version bump only for package @agoric/transform-metering





## [1.2.3](https://github.com/Agoric/agoric-sdk/compare/@agoric/transform-metering@1.2.2...@agoric/transform-metering@1.2.3) (2020-05-04)


### Bug Fixes

* use the new (typed) harden package ([2eb1af0](https://github.com/Agoric/agoric-sdk/commit/2eb1af08fe3967629a3ce165752fd501a5c85a96))





## [1.2.2](https://github.com/Agoric/agoric-sdk/compare/@agoric/transform-metering@1.2.2-alpha.0...@agoric/transform-metering@1.2.2) (2020-04-13)

**Note:** Version bump only for package @agoric/transform-metering





## [1.2.2-alpha.0](https://github.com/Agoric/agoric-sdk/compare/@agoric/transform-metering@1.2.1...@agoric/transform-metering@1.2.2-alpha.0) (2020-04-12)

**Note:** Version bump only for package @agoric/transform-metering





## [1.2.1](https://github.com/Agoric/agoric-sdk/compare/@agoric/transform-metering@1.2.1-alpha.0...@agoric/transform-metering@1.2.1) (2020-04-02)

**Note:** Version bump only for package @agoric/transform-metering





## [1.2.1-alpha.0](https://github.com/Agoric/agoric-sdk/compare/@agoric/transform-metering@1.2.0...@agoric/transform-metering@1.2.1-alpha.0) (2020-04-02)

**Note:** Version bump only for package @agoric/transform-metering





# 1.2.0 (2020-03-26)


### Bug Fixes

* **configurableGlobals:** use to wrap all builtins under SES ([53c4549](https://github.com/Agoric/agoric-sdk/commit/53c4549e3c9ba9de30a0fd2077c3f352339493e9))
* **end-to-end:** metering works for some malicious code ([905061c](https://github.com/Agoric/agoric-sdk/commit/905061cbb7d7bc1c3eda4e434cbc72812cb73d2c))
* **evaluator:** quiescence works ([15adc38](https://github.com/Agoric/agoric-sdk/commit/15adc38228fe14dfac4a52a647b47d3013818aec))
* **lockdown:** Begin working toward lockdown-style SES API ([3e63758](https://github.com/Agoric/agoric-sdk/commit/3e63758fbd0e197cb012d96dbd7d25a2bdd162e3))
* **metering:** bump default combined meter for autoswap compatibility ([ac10627](https://github.com/Agoric/agoric-sdk/commit/ac10627a3524bdd6d2719026497fd37c8d00d25b))
* **metering:** get all tests working again ([f2a3206](https://github.com/Agoric/agoric-sdk/commit/f2a3206ad3c4ba98b225380a289bf49a12857a00))
* **metering:** more cleanups and documentation ([78ced24](https://github.com/Agoric/agoric-sdk/commit/78ced244d3028eadf4689bf44b7407f524ae509f))
* **metering:** properly transform try/catch/finally ([6fd28ae](https://github.com/Agoric/agoric-sdk/commit/6fd28ae7e56e052a9405de98d232a859de05653b))
* **metering:** refactor names and implementation ([f1410f9](https://github.com/Agoric/agoric-sdk/commit/f1410f91fbee61903e82a81368675eef4fa0b836))
* **tame-metering:** get working under SES 1.0 ([8246884](https://github.com/Agoric/agoric-sdk/commit/82468844e4d5ac8a6b1ad46c1009cf0719e701ea))
* **transform-metering:** only enable meters; the host has to disable ([d1b8e84](https://github.com/Agoric/agoric-sdk/commit/d1b8e84361b7ebebb363373dd730f10383e46ef8))
* wrap globals instead of using a Proxy ([35b2d5c](https://github.com/Agoric/agoric-sdk/commit/35b2d5cb8bcab2c86a3093def400057adee73b59))


### Features

* **eval:** end-to-end metered evaluator ([db3acfd](https://github.com/Agoric/agoric-sdk/commit/db3acfd522bd3c7c552c39bf40ebf9f021cb1090))
* **metering:** create a transform to limit resource use ([e2c2b68](https://github.com/Agoric/agoric-sdk/commit/e2c2b68e452eb7608301c4709929971e36d139b1))
* **tame-metering:** no more Proxy, clean up initialization ([467d62b](https://github.com/Agoric/agoric-sdk/commit/467d62b251d576284d35fd33472ac6c58a0c6d52))
* **transform:** add support for passing RegExp literals through constructor ([5c9e1e7](https://github.com/Agoric/agoric-sdk/commit/5c9e1e71fd2ee20b565d582f438df697098d893a))
