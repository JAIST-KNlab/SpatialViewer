var express = require('express');
var router = express.Router();

/* GET users listing. */
router.get('/', function(req, res, next) {
  res.render('conf', { user_type: req.query.user_type });
});

module.exports = router;
