'use strict';

require('should');

describe('Basal', function ( ) {

  var basalprofile = [{'i': 0, 'start': '00:00:00', 'rate': 0, 'minutes': 0},
      {'i': 1, 'start': '00:15:00', 'rate': 2, 'minutes': 15 },
      {'i': 1, 'start': '00:45:00', 'rate': 0.5, 'minutes': 45 }];

 it('should find the right max daily basal', function() {

    var inputs = {'basals': basalprofile};
    var basal = require('../src/profile/basal');
    var maxBasal = basal.getMaxDailyBasalRate(inputs);
    maxBasal.should.equal(2);

  });


 it('should find the right basal for a given timestamp', function() {

    var startingPoint = new Date('2016-06-13T00:20:00.000');
    var startingPoint2 = new Date('2016-06-13T01:00:00.000');
    var basal = require('../src/profile/basal');
    var b = basal.getCurrentBasalRate(basalprofile,startingPoint);
    b.should.equal(2);
    b = basal.getCurrentBasalRate(basalprofile,startingPoint2);
    b.should.equal(0.5);

  });

});
