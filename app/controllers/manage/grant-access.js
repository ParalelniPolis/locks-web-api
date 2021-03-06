'use strict';

module.exports = function(app) {

	var _ = require('underscore');
	var async = require('async');

	app.get('/manage/grant-access', app.middleware.requireAuthenticationRedirect, function(req, res, next) {

		var templateData = {
			title: 'Grant Access',
			bodyClasses: 'manage manage-grant-access',
			layout: 'main'
		};

		async.parallel({
			fromLogs: getCardsFromFailureLog,
			fromExistingCards: getExistingCards,
			existingCard: getExistingCard.bind(undefined, req.query.card_identifier),
			locks: getLocks,
			accesses: getAccesses.bind(undefined, req.query.card_identifier)
		}, function(error, results) {

			if (error) {
				return next(error);
			}

			templateData.fromLogs = results.fromLogs;
			templateData.fromExistingCards = results.fromExistingCards
			templateData.existingCard = results.existingCard;
			templateData.locks = _.map(results.locks, function(lock) {
				lock.can_access = !!_.findWhere(results.accesses, { lock_id: lock.id });
				return lock;
			});

			if (req.query.card_identifier && !templateData.existingCard) {
				templateData.existingCard = {
					identifier: req.query.card_identifier
				};
			}

			res.render('grant-access-form', templateData);
		});
	});

	app.post('/manage/grant-access', app.middleware.requireAuthenticationRedirect, function(req, res, next) {

		var templateData = {
			title: 'Grant Access',
			bodyClasses: 'manage manage-grant-access',
			layout: 'main'
		};

		var data = {
			identifier: req.body.identifier.existing || req.body.identifier.from_existing || req.body.identifier.from_logs,
			contact_name: req.body.contact_name,
			contact_email: req.body.contact_email,
			can_access_locks: req.body.can_access_locks
		};

		if (!data.identifier) {
			templateData.errors = ['Card ID is required'];
			res.status(400);
			return res.render('grant-access-form', templateData);
		}

		async.seq(createOrUpdateCard, updateAccess)(data, function(error, card) {

			if (error) {
				app.lib.util.error(error);
				templateData.errors = ['An unexpected error has occurred.'];
				res.status(500);
				return res.render('grant-access-form', templateData);
			}

			res.redirect('/manage/grant-access?card_identifier=' + encodeURIComponent(card.identifier));
		});
	});

	function getCardsFromFailureLog(cb) {

		app.db.models.FailureLog.query()
			.select()
			.orderBy('created_at', 'desc')
			.limit(20)
			.then(function(results) {
				cb(null, results);
			}).catch(cb);
	}

	function getExistingCards(cb) {

		app.db.models.Card.query()
			.select()
			.orderBy('identifier', 'desc')
			.then(function(results) {
				cb(null, results);
			}).catch(cb);
	}

	function getExistingCard(identifier, cb) {

		if (!identifier) {
			return cb(null, null);
		}

		app.db.models.Card.query()
			.select()
			.where('identifier', identifier)
			.limit(1)
			.then(function(results) {
				cb(null, results[0] || null);
			}).catch(cb);
	}

	function getLocks(cb) {

		app.db.models.Lock.query()
			.select()
			.orderBy('name', 'asc')
			.then(function(results) {
				cb(null, results);
			}).catch(cb);
	}

	function getAccesses(identifier, cb) {

		if (!identifier) {
			return cb(null, []);
		}

		app.db.models.CardLockAccess.query()
			.select('card_lock_access.*')
			.leftJoin('cards', 'cards.id', 'card_lock_access.card_id')
			.andWhere('cards.identifier', identifier)
			.then(function(results) {
				cb(null, results);
			}).catch(cb);
	}

	function createOrUpdateCard(data, cb) {

		getExistingCard(data.identifier, function(error, card) {

			if (error) {
				return cb(error);
			}

			var createOrUpdate = card ? 
				app.db.models.Card.update.bind(app.db.models.Card, card.id) :
				app.db.models.Card.create.bind(app.db.models.Card);

			createOrUpdate(data, function(error) {

				if (error) {
					return cb(error);
				}

				getExistingCard(data.identifier, function(error, card) {
					cb(error, data, card);
				});
			});
		});
	}

	function updateAccess(data, card, cb) {

		async.series([

			function clearAccess(next) {

				app.db.models.CardLockAccess.query()
					.del()
					.where('card_id', card.id)
					.then(function() {
						next();
					}).catch(next);
			},

			function addAccess(next) {

				if (_.isEmpty(data.can_access_locks)) {
					return next();
				}

				var dataArray = _.map(data.can_access_locks, function(lockId) {
					return {
						card_id: card.id,
						lock_id: lockId
					};
				});

				app.db.models.CardLockAccess.createBulk(dataArray, next);
			}

		], function(error) {
			cb(error, card);
		});
	}
};
