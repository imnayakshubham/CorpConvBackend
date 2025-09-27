// routes/auth.ts
const express = require('express');
const {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} = require("@simplewebauthn/server");
const User = require('../models/userModel');
const { projection } = require('../constants');

const router = express.Router();

router.post("/register/options", authMiddleware, async (req, res) => {
    try {
        const { id, nickname } = req.body;
        const user = await User.findOne({ _id: id }, projection);
        if (!user) {
            return res.error({
                message: "User not found",
                code: 404,
            });
        }
        const excludeCredentials = (user.credentials || []).map((cred) => ({
            id: cred.credentialID,
            type: "public-key",
            transports: cred.transports,
        }));
        const options = generateRegistrationOptions({
            rpName: "Production App",
            rpID: process.env.RP_ID,
            userID: user._id.toString(),
            userName: nickname || user.nickname,
            attestationType: "none",
            authenticatorSelection: { userVerification: "preferred" },
            excludeCredentials,
        });
        req.session.challenge = options.challenge;
        return res.success({ result: options });
    } catch (error) {
        return res.error({ message: "Failed to generate registration options", error, code: 500 });
    }
});

router.post("/register/verify", authMiddleware, async (req, res) => {
    try {
        const { id, credential, nickname } = req.body;
        const expectedChallenge = req.session.challenge;
        const expectedOrigin = process.env.ORIGIN;
        const expectedRPID = process.env.RP_ID;

        const user = await User.findOne({ _id: id }, projection);
        if (!user) {
            return res.error({
                message: "User not found",
                code: 404,
            });
        }

        const verification = await verifyRegistrationResponse({
            credential,
            expectedChallenge,
            expectedOrigin,
            expectedRPID,
        });

        if (!verification.verified) {
            return res.error({ message: "Registration verification failed", code: 400 });
        }

        user.credentials.push({
            credentialID: credential.id,
            publicKey: verification.registrationInfo.credentialPublicKey,
            transports: credential.transports,
            counter: verification.registrationInfo.counter,
            nickname: nickname || "",
        });
        await user.save();
        return res.success({ message: "Registration successful" });
    } catch (error) {
        return res.error({ message: "Failed to verify registration", error, code: 500 });
    }
});

router.post("/login/options", async (req, res) => {
    try {
        const { id } = req.body;
        const user = await User.findOne({ _id: id }, projection);
        if (!user || !user.credentials.length) {
            return res.error({ message: "No credentials registered", code: 404 });
        }
        const allowCredentials = user.credentials.map((cred) => ({
            id: cred.credentialID,
            type: "public-key",
            transports: cred.transports,
        }));
        const options = generateAuthenticationOptions({
            rpID: process.env.RP_ID,
            allowCredentials,
            userVerification: "preferred",
        });
        req.session.challenge = options.challenge;
        return res.success({ result: options });
    } catch (error) {
        return res.error({ message: "Failed to generate authentication options", error, code: 500 });
    }
});

router.post("/login/verify", async (req, res) => {
    try {
        const { id, credential } = req.body;
        const expectedChallenge = req.session.challenge;
        const expectedOrigin = process.env.ORIGIN;
        const expectedRPID = process.env.RP_ID;

        const user = await User.findOne({ _id: id }, projection);
        if (!user) {
            return res.error({ message: "User not found", code: 404 });
        }
        const matchingCred = user.credentials.find(
            (cred) => cred.credentialID === credential.id
        );
        if (!matchingCred) {
            return res.error({ message: "Credential not found", code: 400 });
        }
        const verification = await verifyAuthenticationResponse({
            credential,
            expectedChallenge,
            expectedOrigin,
            expectedRPID,
            authenticator: {
                credentialID: matchingCred.credentialID,
                credentialPublicKey: matchingCred.publicKey,
                counter: matchingCred.counter,
            },
        });
        if (!verification.verified) {
            return res.error({ message: "Authentication verification failed", code: 400 });
        }
        matchingCred.counter = verification.authenticationInfo.newCounter;
        await user.save();
        // Issue JWT/session here if relevant
        return res.success({ message: "Authentication successful", result: { nickname: user.nickname } });
    } catch (error) {
        return res.error({ message: "Failed to verify authentication", error, code: 500 });
    }
});


module.exports = router;
