# Data Vault Spec

# Introduction

This document defines a data format and encryption algorithm agnostic specification for storing, accessing, and deleting end-to-end encrypted user data blobs. The goals being that:

1. clients written to this specification should not have to trust the registry provider to keep user data private.
2. clients should be able to run on a variety of platforms with minimal integration effort.
3. clients can choose from a variety of encryption algorithms to suite their needs.
4. power users can run their own instance of the data registry on a platform of their choosing.

This specification makes use of the OpenPGP standard which allows the client to pick between several encryption algorithms to optimize for performance or security. It also requires all encryption and decryption to be performed by the client and that no plain-text data ever be sent to the registry. The communication between client and server is transmitted in accordance with an HTTP API to facilitate integration with a wide variety of platforms and developer backgrounds.

Bloom will be providing an open source reference implementation of the data registry built with docker. This allows power users to easily deploy their own instances of the registry.

This document also defines some suggested methods for safe storage and transmission of PGP private keys for the purpose of using the registry to sync data between client devices belonging to the same user as well as recommended default encryption parameters to use for PGP key generation. The goal is to gain a security guarantee similar to [1Password](https://1password.com/files/1Password%20for%20Teams%20White%20Paper.pdf) by using a PGP key encrypted with a strong password that is not stored on a computer.

# Data Model

This example uses JSON but the implementation could just as easily be normalized SQL tables

Entity:

    {
    	// Public Key used to encrypt data blobs for this entity
    	"pgpKey": "-----BEGIN PGP PUBLIC KEY BLOCK ...",
    	// unique PGP key fingerprint (useful for indexing and verifying PGP keys)
    	"pgpKeyFingerprint": "7EF888AA9A65F75E3F12672B4D77E5687828606A",
    	"deletedIds": [2,4]
    	// return to the client as base 64 encoded data blob (the format of which is unknown to the registry)
    	"data": [
    		"YXNnYWRnaGFzZGdhZGg0IHVldHNmaGZna2pnaCBka2drbXhnIHNkZmdkZmc",
    		"YXNnYWRnaGFzZGdhZGg0IHVldHNmaGZna2pnaCBka2drbXhnIHNkZmdkZmc",
    		null,
    		"YXNnYWRnaGFzZGdhZGg0IHVldHNmaGZna2pnaCBka2drbXhnIHNkZmdkZmc",
    		null
    	]
    }

When a new data blob is added to an entity the new data should be appended to the end of data array. When a data item is deleted, the cyphertext for that index should be set to null and the index should be appended to the deletedIds array (these two operations should happen atomically). This helps clients quickly check for new data that needs to be synced by querying for the length of the data array or check which of their cached data need to be deleted by querying with their cached deletedCount.

# Authorization Endpoints

## POST /auth/request-token?fingerprint=<pgpKeyFingerprint>

Initiates an access token request challenge for the requested pgp key fingerprint. If an entity does not already exist with a matching pgp key fingerprint then one is created. <pgpKeyFingerprint> should be replaced with the 160 bit v4 fingerprint specified by OpenPGP. Returns the access token which needs to be subsequently signed before access is granted

Example POST url:

    https://example.com/auth/request-token?fingerprint=7EF888AA9A65F75E3F12672B4D77E5687828606A

Example response (aplication/json):

    {
    	"token": "889a35f4-f4ef-431d-8eb7-629a126f972e"
    }

## POST /auth/validate-token

Validates an access token for the requested pgp key fingerprint. The access token and a valid **detached** pgp signature of the token must be submitted for the token to be marked as validated. Once validated the token can be used until it is expired. The first time validating an access token for a given fingerprint the client must also send a pgp public key with the request. To prevent leaking information about which key fingerprints have data stored in the registry and to mitigate possible future fingerprint preimage attacks the registry will process requests in this way.

1. Lookup pending access token and linked entity by the posted access token uuid
   1. If none are found return 404
2. If the request does not contain a pgp key
   1. Verify a pgp key exists for the entity and the posted signature is valid against that key
      1. If either is false return 401
      2. Else authorize the token and return it
3. Else if it does contain a pgp key
   1. Verify that a pgp key does not already exist for the entity
      1. If it does return 401
   2. Verify the posted signature is valid against the posted key and token uuid
      1. if it is not valid return 401
      2. Store the new pgp key on the entity and authorize/return the access token

Example POST body (application/json):

    // first request for a fingerprint
    {
    	"accessToken": "889a35f4-f4ef-431d-8eb7-629a126f972e",
    	"signature": "-----BEGIN PGP SIGNATURE----- ...",
    	"pgpKey": "-----BEGIN PGP PUBLIC KEY BLOCK ..."
    }

    // subsequent requests
    {
    	"accessToken": "889a35f4-f4ef-431d-8eb7-629a126f972e",
    	"signature": "-----BEGIN PGP SIGNATURE----- ..."
    }

Example response (aplication/json):

    {
    	"expiresAt": 1546883485
    }

# REST Endpoints

The REST endpoints require an authorized access token which can be obtained by using the Authorization endpoints above. Then token must be specified in the Authorization header to the HTTP request `Authorization: Bearer <token>`

Javascript example:

    fetch(
          `http://example.com/data`,
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          }
    )

## GET /data/me

Returns the entity object associated with the included access token without the data blobs.

Example response (aplication/json):

    {
    	"pgpKey": "-----BEGIN PGP PUBLIC KEY BLOCK ...",
    	"pgpKeyFingerprint": "7EF888AA9A65F75E3F12672B4D77E5687828606A",
    	// total number of data blobs
    	"dataCount" : 10,
    	// number of delete data blobs
    	"deletedCount": 2,
    }

## GET /data/:start/:end

Returns the data objects associated with the included access token and between the start and end ids including the end. if end is omitted only the data with the starting id will be returned

Example GET url:

    https://example.com/data/7/9

Example response (aplication/json):

    [
    	{
    		"id": 7,
    		"cyphertext": "YXNnYWRnaGFzZGdhZGg0IHVldHNmaGZna2pnaCBka2drbXhnIHNkZmdkZmc"
    	},
    	{
    		"id": 8,
    		"cyphertext": null,
    	},
    	{
    		"id": 9,
    		"cyphertext": "YXNkZmdlIHJ5NCA1dWV5aiBoIGR0aTM1dXdoZ3R1d3J0aHNhdHdlYWdkaHJ0aGFxcg=="
    	}
    ]

## DELETE /data/:start/:end

Deletes the data objects associated with the included access token and the included ids starting with :start and ending with :and inclusive. Detached pgp signatures can be included in the body which can be verified upon receiving the deleted data. If signatures are included they must be detached pgp signatures of the form "delete data id :id" where :id should be replaced with the id of the data being deleted. They also must be in ascending order respective to the ids

    // to delete the 10th 11th and 12th data blobs
    https://example.com/data/9/11

Example optional request body (aplication/json):

    {
    	"signatures": [
    		"-----BEGIN PGP SIGNATURE----- ...",
    		"-----BEGIN PGP SIGNATURE----- ...",
    		"-----BEGIN PGP SIGNATURE----- ...",
    	]
    }

Example response (aplication/json):

    {
    	"dataCount" : 10,
    	"deletedCount": 3
    }

## POST /data

Create a new data blob for the entity associated with the included access token

Example POST url:

    https://example.com/data

Example request body (aplication/json):

    {
    	// optional expected id, request will rollback if new id does not match
    	"id": 9,
    	"cyphertext": "YXNnYWRnaGFzZGdhZGg0IHVldHNmaGZna2pnaCBka2drbXhnIHNkZmdkZmc"
    }

Example response (aplication/json):

    {
    	"id": 9
    }

**GET /deletions/:start/:end**

Returns the ids of the data blobs deleted between the **i\***th\* and **j\***th\* deletion inclusive. j is optional

Example GET url:

    // to get the third deletion (0 indexed)
    https://example.com/data/deletions/2
    // to get the third fourth, and fifth deletion
    https://example.com/data/deletions/2/4

Example response (aplication/json):

    [
    	{
    		id: 2,
    		"signature": "-----BEGIN PGP SIGNATURE----- ..."
    	},
    	{
    		id: 50,
    		"signature": null
    	},
    	{
    		id: 6,
    		"signature": "-----BEGIN PGP SIGNATURE----- ..."
    	}
    ]

A typical scenario might be as follows:

1. Client device A adds 3 data blobs for an entity
2. Entity decides to delete one of the blobs using device A
3. Device A caches the deletedCount as 1
4. The same entity syncs his pgp key to client device B
5. Client device B notices that the deletedCount is > 0 and calls /deleted/0
6. Entity decides to delete another blob on device B
7. Next time device A syncs it notices the deleted count is now 2 and calls /deleted/1 since it already deleted its cached data for the first deleted item

# Security Recommendations

1. When posting new data:
   1. Make use of the "id" request parameter to prevent replay attacks and duplicated data.
   2. Sign **and** encrypt your data blobs and verify them upon receipt to reduce risk of a malicious provider returning invalid data.
   3. Include the data id in the signed/encrypted data to prevent the possibility of a malicious provider re-ordering your data
2. When deleting data make use of the "signature" parameter and verify it upon receiving deletions. This makes it difficult for a provider to fake a deletion.
