(function executeRule(current, previous) {
    if (!current.getValue('owner')) current.setValue('owner', gs.getUserID());
})(current, previous);
