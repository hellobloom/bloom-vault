'use strict'

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(`
    BEGIN TRANSACTION;

    COMMIT;
    `)
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.sequelize.query(`
    BEGIN TRANSACTION;
   
    COMMIT;
    `)
  },
}
